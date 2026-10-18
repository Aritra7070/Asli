// Server-side Arkiv layer: reads (public client) and demo writes (role signers).
// Signer keys come from env vars (.env.local or Vercel project env). They are
// throwaway Tiramisu testnet keys used only to sign synthetic demo data.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  jsonToPayload,
  ExpirationTime,
} from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { i32, str, u64 } from "@arkiv-network/sdk/attr";
import { and, eq, lte } from "@arkiv-network/sdk/query";
import { http } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

import bundledSnapshot from "@/arkiv/cache-snapshot.json";
import { DEMO, RPC_URL } from "@/lib/constants";
import type {
  Attestation,
  BatchReport,
  ChainEntityLike,
  FlagRecord,
  FeedItem,
  RadarData,
  Registry,
  TrailEntry,
} from "@/lib/types";

export type Role = "mfr" | "dist" | "reliant" | "qm" | "relay" | "fake";

const ROLE_ENV: Record<Role, string> = {
  mfr: "ASLI_MFR_PRIVATE_KEY",
  dist: "ASLI_DIST_PRIVATE_KEY",
  reliant: "ASLI_RELIANT_PRIVATE_KEY",
  qm: "ASLI_QM_PRIVATE_KEY",
  relay: "ASLI_RELAY_PRIVATE_KEY",
  fake: "ASLI_FAKE_PRIVATE_KEY",
};

// Optional access key for the shared RPC — raises the anonymous query budget,
// which really does run out under load (see arkiv/friction.md #15). Sent as
// an X-API-KEY header so the key never appears in URLs or request logs.
const ACCESS_KEY =
  process.env.ARKIV_ACCESS_KEY ??
  process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ??
  "";

function rpcAuth(): { fetchOptions?: { headers: Record<string, string> } } {
  return ACCESS_KEY
    ? { fetchOptions: { headers: { "X-API-KEY": ACCESS_KEY } } }
    : {};
}

export const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(RPC_URL, {
    timeout: 10_000,
    retryCount: 1,
    ...rpcAuth(),
  }),
});

// ---------------------------------------------------------- resilience
// The Tiramisu RPC chokes under load — and the WebSocket transport finally
// showed why: "unauthenticated query budget exhausted" (an access key raises
// the quota; the HTTP surface hangs silently instead of returning that error
// — see arkiv/friction.md #15). Three defenses keep the app alive:
//   1. an access key when configured (see rpcAuth above) — the real cure;
//   2. every chain read goes through a deadline + one retry, so a hung
//      request fails fast instead of freezing a page render;
//   3. hot reads are served from a cache with stale-while-revalidate —
//      when the RPC is slow, pages keep rendering the last good copy.

const READ_DEADLINE_MS = 6_000;

function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: no response in ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function chainCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withDeadline(fn(), READ_DEADLINE_MS, label);
  } catch (e) {
    if (e instanceof Error && e.message.includes("no response in")) {
      // one retry — a fresh request usually gets a fresh connection
      return await withDeadline(fn(), READ_DEADLINE_MS, `${label} (retry)`);
    }
    throw e;
  }
}

type CacheEntry = { at: number; value: unknown };
const readCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

// ---------------------------------------------------- cache persistence
// Last-good copies are persisted so a restart — or a fresh serverless
// instance on a cold deploy — can still serve data while the shared RPC is
// stalled. Two sources, newest timestamp wins:
//   * arkiv/cache-snapshot.json — a snapshot committed to the repo and
//     bundled into the build (survives cold starts on Vercel);
//   * .cache/reads.json — the live cache this process keeps updating
//     (git-ignored; local runtime — writes fail silently on read-only fs).

const CACHE_VERSION = 1;
const LOCAL_CACHE_FILE = path.join(process.cwd(), ".cache", "reads.json");

type CacheFile = { version: number; entries: Record<string, CacheEntry> };

function encodeCache(): string {
  const entries: Record<string, CacheEntry> = {};
  for (const [k, v] of readCache) entries[k] = v;
  return JSON.stringify(
    { version: CACHE_VERSION, entries } as CacheFile,
    (_k, v) => (typeof v === "bigint" ? { __bigint: v.toString() } : v)
  );
}

function decodeCache(raw: string): CacheFile | null {
  try {
    const parsed = JSON.parse(raw, (_k, v) =>
      v && typeof v === "object" && "__bigint" in (v as object)
        ? BigInt((v as { __bigint: string }).__bigint)
        : v
    ) as CacheFile;
    return parsed?.entries && typeof parsed.entries === "object"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function persistCache() {
  try {
    mkdirSync(path.dirname(LOCAL_CACHE_FILE), { recursive: true });
    writeFileSync(LOCAL_CACHE_FILE, encodeCache());
  } catch {
    // read-only filesystem (serverless) — the bundled snapshot covers cold starts
  }
}

let cacheLoaded = false;
function ensureCacheLoaded() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  const sources: Array<CacheFile | null> = [
    bundledSnapshot as unknown as CacheFile,
  ];
  try {
    sources.push(decodeCache(readFileSync(LOCAL_CACHE_FILE, "utf8")));
  } catch {
    // no local cache yet
  }
  for (const src of sources) {
    if (!src || src.version !== CACHE_VERSION || !src.entries) continue;
    for (const [key, entry] of Object.entries(src.entries)) {
      if (!entry || typeof entry.at !== "number") continue;
      const existing = readCache.get(key);
      if (!existing || existing.at < entry.at) readCache.set(key, entry);
    }
  }
}

/**
 * Call after any successful write. Cached reads are marked stale — served
 * instantly, refreshed in the background — never cleared: a stall right
 * after a write must not be able to blank the site. The write also kicks
 * refreshes of the pages it touches (see warmAfterWrite).
 */
export function bustReadCache() {
  for (const entry of readCache.values()) entry.at = 0;
}

/** Fire-and-forget refreshes so the demo's own writes show up fast. */
function warmAfterWrite(batchCode?: string) {
  const jobs: Array<Promise<unknown>> = [
    getCounts(),
    getLatestFeed(10),
    fetchRegistries(),
  ];
  if (batchCode) jobs.push(getBatchReport(batchCode.toUpperCase()));
  void Promise.allSettled(jobs);
}

function startRefresh<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((value) => {
      readCache.set(key, { at: Date.now(), value });
      persistCache();
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function swr<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  ensureCacheLoaded();
  startWarmer();
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  if (hit) {
    // expired — serve instantly, refresh in the background
    void startRefresh(key, fn).catch(() => {});
    return hit.value as T;
  }
  return startRefresh(key, fn);
}

// Self-healing: every so often, refresh the pages the demo relies on, so a
// stall window heals itself even if nobody is browsing. (On serverless this
// interval never gets a chance to fire; the bundled snapshot covers instead.)
let warming = false;
function startWarmer() {
  const g = globalThis as { __asliWarmerStarted?: boolean };
  if (g.__asliWarmerStarted) return;
  g.__asliWarmerStarted = true;
  const timer = setInterval(() => {
    if (warming) return;
    warming = true;
    void Promise.allSettled([
      getCounts(),
      getLatestFeed(10),
      fetchRegistries(),
      getRadar(45),
      getBatchReport(DEMO.heroCode),
      getBatchReport(DEMO.cleanCode),
      getBatchReport(DEMO.quickCode),
    ]).finally(() => {
      warming = false;
    });
  }, 45_000);
  (timer as unknown as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------- wallets

const walletCache = new Map<Role, ReturnType<typeof createWalletClient>>();

export function hasWallet(role: Role): boolean {
  const pk = process.env[ROLE_ENV[role]];
  return typeof pk === "string" && pk.startsWith("0x") && pk.length === 66;
}

export function walletFor(role: Role) {
  const cached = walletCache.get(role);
  if (cached) return cached;
  const pk = process.env[ROLE_ENV[role]];
  if (!pk || !pk.startsWith("0x")) {
    throw new Error(
      `Signer ${role} is not configured (missing ${ROLE_ENV[role]}). Run \`npm run wallets:new\` and fund the demo signers.`
    );
  }
  const account = privateKeyToAccount(pk as `0x${string}`, { nonceManager });
  const client = createWalletClient({
    chain: tiramisu,
    transport: http(RPC_URL, {
      timeout: 15_000,
      retryCount: 1,
      ...rpcAuth(),
    }),
    account,
  });
  walletCache.set(role, client);
  return client;
}

export function addressFor(role: Role): string | undefined {
  if (!hasWallet(role)) return undefined;
  return privateKeyToAccount(process.env[ROLE_ENV[role]] as `0x${string}`)
    .address;
}

// ---------------------------------------------------------- expiry math

// Arkiv counts lifetimes in blocks. The SDK resolves durations and dates at a
// nominal 2s block time (Tiramisu runs at exactly 2s), and an extension *sets*
// an absolute deadline — the engine rejects one that would move it earlier.
// So "renew for N days" is computed as "current expiry + N days", never
// "now + N days": a create pinned to a printed expiry (e.g. 2027) can sit far
// beyond now + N days, and a from-now extension would then be refused.
const BLOCKS_PER_DAY = 43_200n; // 86,400s / 2s per block
export const EXTENSION_DAYS = 30;

async function nextExpiryBlock(
  entityKey: string,
  days: number
): Promise<bigint> {
  const { expiresAt } = await chainCall("getEntity", () =>
    publicClient.getEntity(entityKey as `0x${string}`)
  );
  const raw = expiresAt as unknown as bigint | number;
  const current = typeof raw === "bigint" ? raw : BigInt(raw);
  return current + BigInt(days) * BLOCKS_PER_DAY;
}

// ---------------------------------------------------------------- helpers

const SEL = {
  key: true,
  owner: true,
  creator: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
  creationFlags: true,
  contentType: true,
  payload: true,
  attributes: true,
} as const;

type E = ChainEntityLike;

function attr(e: E, name: string): { type: string; value: unknown } | undefined {
  return e.attributes?.[name];
}

function attrStr(e: E, name: string): string | undefined {
  const a = attr(e, name);
  return a?.type === "str" ? (a.value as string) : undefined;
}

function attrNum(e: E, name: string): number | undefined {
  const a = attr(e, name);
  if (!a) return undefined;
  if (a.type === "u64" || a.type === "u256") return Number(a.value as bigint);
  if (a.type === "i32") return a.value as number;
  if (a.type === "dec") return Number(a.value as string);
  return undefined;
}

function attrBool(e: E, name: string): boolean | undefined {
  const a = attr(e, name);
  return a?.type === "bool" ? (a.value as boolean) : undefined;
}

function attrAddr(e: E, name: string): string | undefined {
  const a = attr(e, name);
  return a?.type === "addr" ? (a.value as string) : undefined;
}

function payloadJson(e: E): Record<string, unknown> {
  try {
    return (e as unknown as { toJson: () => unknown }).toJson() as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function stripUndefined<T extends Record<string, unknown>>(
  obj: T
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}

async function fetchAll(where: unknown, limit = 200): Promise<E[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any = await chainCall("arkiv query", () =>
    (publicClient as any).select(SEL).where(where).limit(limit).fetch()
  );
  const out: E[] = [...page.entities];
  let guard = 0;
  while (page.hasNextPage() && guard++ < 20) {
    const prev = page;
    page = await chainCall("arkiv query (next page)", () => prev.next());
    out.push(...page.entities);
  }
  return out;
}

async function fetchWhere(where: unknown, limit = 200): Promise<E[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await chainCall("arkiv query", () =>
    (publicClient as any).select(SEL).where(where).limit(limit).fetch()
  );
  return page.entities as E[];
}

// ---------------------------------------------------------------- reads

export async function fetchRegistries(): Promise<Record<string, Registry>> {
  return swr("registries", 30_000, async () => {
    const entities = await fetchAll(eq("type", str("asli.registry")));
    const map: Record<string, Registry> = {};
    for (const e of entities) {
      const wallet = attrAddr(e, "wallet_addr");
      if (!wallet) continue;
      map[wallet.toLowerCase()] = {
        wallet,
        name: attrStr(e, "name") ?? "(unnamed)",
        city: attrStr(e, "city") ?? "",
        role: attrStr(e, "role") ?? "",
        sinceMs: attrNum(e, "since_ms"),
        entityKey: e.key,
        registeredAtBlock: e.createdAt,
      };
    }
    return map;
  });
}

function toAttestation(e: E): Attestation {
  return {
    entityKey: e.key,
    creator: e.creator,
    blob: "",
    drugCode: attrStr(e, "drug_code"),
    drugName: attrStr(e, "drug_name"),
    status: attrStr(e, "status"),
    canonical: attrBool(e, "canonical") ?? false,
    units: attrNum(e, "units"),
    expAtMs: attrNum(e, "exp_at_ms"),
    mfgAtMs: attrNum(e, "mfg_at_ms"),
    city: attrStr(e, "city"),
    note: undefined,
    createdAtBlock: e.createdAt,
    expiresAtBlock: e.expiresAt,
    payload: payloadJson(e),
  };
}

function toTrailEntry(e: E): TrailEntry {
  return {
    entityKey: e.key,
    creator: e.creator,
    hop: attrNum(e, "hop"),
    city: attrStr(e, "city"),
    actorKind: attrStr(e, "actor_kind"),
    atMs: attrNum(e, "at_ms"),
    note: (() => {
      const p = payloadJson(e);
      return typeof p.note === "string" ? p.note : undefined;
    })(),
    createdAtBlock: e.createdAt,
  };
}

function toFlag(e: E): FlagRecord {
  const p = payloadJson(e);
  return {
    entityKey: e.key,
    creator: e.creator,
    kind: attrStr(e, "kind") ?? "flag",
    severity: attrNum(e, "severity") ?? 1,
    batchCode: attrStr(e, "batch_code"),
    city: attrStr(e, "city"),
    title: typeof p.title === "string" ? p.title : undefined,
    detail: typeof p.detail === "string" ? p.detail : undefined,
    atMs: attrNum(e, "at_ms"),
    readonly: e.creationFlags?.readonly ?? false,
    permissionlessExtension:
      e.creationFlags?.permissionlessExtension ?? false,
    createdAtBlock: e.createdAt,
    expiresAtBlock: e.expiresAt,
  };
}

/** The full verification report for one batch code — everything /b/[code] renders. */
async function computeBatchReport(code: string): Promise<BatchReport> {
  const [head, entities, registries] = await Promise.all([
    chainCall("blockNumber", () => publicClient.getBlockNumber()),
    fetchWhere(eq("batch_code", str(code))),
    fetchRegistries(),
  ]);

  const attestations: Attestation[] = [];
  const trail: TrailEntry[] = [];
  const flags: FlagRecord[] = [];

  for (const e of entities) {
    const t = (attrStr(e, "type") ?? "").replace(/^asli\./, "");
    if (t === "batch") attestations.push(toAttestation(e));
    else if (t === "custody") trail.push(toTrailEntry(e));
    else if (t === "flag") flags.push(toFlag(e));
  }

  trail.sort(
    (a, b) =>
      (a.atMs ?? 0) - (b.atMs ?? 0) ||
      Number(a.createdAtBlock - b.createdAtBlock)
  );
  flags.sort(
    (a, b) => b.severity - a.severity || (b.atMs ?? 0) - (a.atMs ?? 0)
  );
  attestations.sort((a, b) => Number(a.createdAtBlock - b.createdAtBlock));

  const creators = new Set(attestations.map((a) => a.creator.toLowerCase()));
  let registeredSigners = 0;
  let unregisteredSigners = 0;
  for (const c of creators) {
    if (registries[c]) registeredSigners++;
    else unregisteredSigners++;
  }

  const blocked = flags.find((f) => f.kind === "recall" && f.severity >= 3);

  let kind: BatchReport["verdict"]["kind"] = "unverified";
  if (blocked) kind = "recalled";
  else if (registeredSigners > 0 && unregisteredSigners > 0)
    kind = "counterfeit";
  else if (registeredSigners > 0) kind = "verified";

  const cities = [
    ...new Set(trail.map((t) => t.city).filter((c): c is string => !!c)),
  ];

  return {
    code,
    found: entities.length > 0,
    head,
    verdict: { kind, registeredSigners, unregisteredSigners, blockedByRecall: blocked },
    attestations,
    trail,
    flags,
    registries,
    stats: {
      scans: trail.length,
      cities,
      lastActivityMs: trail.length
        ? trail[trail.length - 1].atMs
        : undefined,
    },
  };
}

/** Cached getter — writes bust the cache (see bustReadCache). */
export async function getBatchReport(code: string): Promise<BatchReport> {
  return swr(`batch:${code}`, 15_000, () => computeBatchReport(code));
}

export async function getRadar(soonDays = 45): Promise<RadarData> {
  return swr(`radar:${soonDays}`, 30_000, () => computeRadar(soonDays));
}

async function computeRadar(soonDays = 45): Promise<RadarData> {
  const soonMs = Date.now() + soonDays * 86_400_000;
  const [head, soonBatchEntities, allBatchEntities, recallEntities, allFlags, custody, registries] =
    await Promise.all([
      chainCall("blockNumber", () => publicClient.getBlockNumber()),
      fetchWhere(
        and(eq("type", str("asli.batch")), lte("exp_at_ms", u64(soonMs))),
        200
      ),
      fetchAll(eq("type", str("asli.batch"))),
      fetchWhere(and(eq("type", str("asli.flag")), eq("kind", str("recall"))), 100),
      fetchAll(eq("type", str("asli.flag"))),
      fetchAll(eq("type", str("asli.custody"))),
      fetchAll(eq("type", str("asli.registry"))),
    ]);

  const expiringSoon = soonBatchEntities
    .map((e) => {
      const exp = attrNum(e, "exp_at_ms") ?? 0;
      return {
        code: attrStr(e, "batch_code") ?? "?",
        drugName: attrStr(e, "drug_name"),
        expAtMs: exp,
        daysLeft: Math.round((exp - Date.now()) / 86_400_000),
        status: attrStr(e, "status"),
        canonical: attrBool(e, "canonical") ?? false,
        creator: e.creator,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const cityMap = new Map<string, number>();
  for (const e of custody) {
    const c = attrStr(e, "city");
    if (c) cityMap.set(c, (cityMap.get(c) ?? 0) + 1);
  }

  return {
    head,
    expiringSoon,
    recalls: recallEntities.map(toFlag).sort((a, b) => b.severity - a.severity),
    cityCounts: [...cityMap.entries()]
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count),
    totals: {
      batches: allBatchEntities.length,
      scans: custody.length,
      flags: allFlags.length,
      registries: registries.length,
    },
  };
}

export async function getCounts() {
  return swr("counts", 15_000, async () => {
    const [batches, custody, flags, registries] = await Promise.all([
      fetchAll(eq("type", str("asli.batch"))),
      fetchAll(eq("type", str("asli.custody"))),
      fetchAll(eq("type", str("asli.flag"))),
      fetchAll(eq("type", str("asli.registry"))),
    ]);
    return {
      batches: batches.length,
      scans: custody.length,
      flags: flags.length,
      registries: registries.length,
    };
  });
}

export function toFeedItem(e: E, head: bigint): FeedItem {
  const t = (attrStr(e, "type") ?? "unknown").replace(/^asli\./, "");
  const batchCode = attrStr(e, "batch_code");
  const atMs =
    attrNum(e, "at_ms") ??
    Date.now() - Number(head - e.createdAt) * 2000;

  let title = "Activity";
  let sub = "";
  if (t === "batch") {
    title = `Batch attested — ${batchCode ?? "?"}`;
    sub = attrStr(e, "drug_name") ?? "";
  } else if (t === "custody") {
    title = `Scan — ${batchCode ?? "?"}`;
    sub = `${attrStr(e, "actor_kind") ?? "actor"} · ${attrStr(e, "city") ?? ""}`;
  } else if (t === "flag") {
    const kind = attrStr(e, "kind") ?? "flag";
    title =
      kind === "recall"
        ? `RECALL — ${batchCode ?? "?"}`
        : `Report — ${batchCode ?? "?"}`;
    sub = (() => {
      const p = payloadJson(e);
      return typeof p.title === "string" ? p.title : "";
    })();
  } else if (t === "registry") {
    title = `Registered — ${attrStr(e, "name") ?? "?"}`;
    sub = `${attrStr(e, "role") ?? ""} · ${attrStr(e, "city") ?? ""}`;
  }

  return {
    entityKey: e.key,
    kind: t as FeedItem["kind"],
    title,
    sub,
    creator: e.creator,
    atBlock: e.createdAt,
    atMs,
  };
}

export async function getLatestFeed(limit = 12): Promise<FeedItem[]> {
  return swr(`feed:${limit}`, 10_000, async () => {
    const head = await chainCall("blockNumber", () =>
      publicClient.getBlockNumber()
    );
    // One query per entity type (the query language has no OR across separate
    // attribute sets that we can rely on), merged and sorted newest-first.
    const [batches, custody, flags] = await Promise.all([
      fetchWhere(eq("type", str("asli.batch")), limit),
      fetchWhere(eq("type", str("asli.custody")), limit),
      fetchWhere(eq("type", str("asli.flag")), limit),
    ]);
    return [...batches, ...custody, ...flags]
      .map((e) => toFeedItem(e, head))
      .sort((a, b) => Number(b.atBlock - a.atBlock))
      .slice(0, limit);
  });
}

// ---------------------------------------------------------------- writes

export async function addCustodyScan(opts: {
  role: Role;
  batchCode: string;
  city: string;
  actorKind: string;
  note: string;
}) {
  const wallet = walletFor(opts.role);
  const existing = await fetchWhere(eq("batch_code", str(opts.batchCode)), 200);
  const custodyCount = existing.filter(
    (e) => attrStr(e, "type") === "asli.custody"
  ).length;
  const extendKeys = existing
    .filter(
      (e) => attrStr(e, "type") === "asli.batch" && attrBool(e, "canonical") === true
    )
    .map((e) => e.key);

  // A verified scan keeps every canonical record of this batch alive — a
  // Lifetime Extension of +30 days added to each record's *current* deadline
  // (see nextExpiryBlock above), computed per record in the same atomic tx.
  const extensions = await Promise.all(
    extendKeys.map(async (entityKey) => ({
      entityKey: entityKey as `0x${string}`,
      expires: ExpirationTime.atBlock(
        await nextExpiryBlock(entityKey, EXTENSION_DAYS)
      ),
    }))
  );

  const res = await wallet.executeBatch({
    creates: [
      {
        payload: jsonToPayload({ note: opts.note }),
        contentType: "application/json",
        attributes: {
          type: str("asli.custody"),
          batch_code: str(opts.batchCode),
          hop: i32(custodyCount),
          city: str(opts.city),
          actor_kind: str(opts.actorKind),
          at_ms: u64(Date.now()),
        },
        expires: ExpirationTime.fromDays(60),
      },
    ],
    extensions,
  });

  bustReadCache();
  warmAfterWrite(opts.batchCode);
  return {
    txHash: res.txHash as string,
    entityKey: (res.createdEntities?.[0] ?? undefined) as string | undefined,
    extended: extendKeys.length,
  };
}

export async function createFlag(opts: {
  role: Role;
  batchCode: string;
  kind: "recall" | "counterfeit_report" | "expiry_report";
  severity: number;
  title: string;
  detail: string;
  city?: string;
}) {
  const wallet = walletFor(opts.role);
  const res = await wallet.createEntity({
    payload: jsonToPayload({ title: opts.title, detail: opts.detail }),
    contentType: "application/json",
    attributes: stripUndefined({
      type: str("asli.flag"),
      batch_code: str(opts.batchCode),
      kind: str(opts.kind),
      severity: i32(opts.severity),
      at_ms: u64(Date.now()),
      city: opts.city ? str(opts.city) : undefined,
    }),
    expires: ExpirationTime.fromDays(200),
    // A flag is a record: write-once, and ANY wallet can keep it alive.
    flags: { readonly: true, permissionlessExtension: true },
  });
  bustReadCache();
  warmAfterWrite(opts.batchCode);
  return { txHash: res.txHash as string, entityKey: res.entityKey as string };
}

export async function counterfeitShipment(opts: {
  batchCode: string;
  drugCode: string;
  drugName: string;
  city?: string;
}) {
  const wallet = walletFor("fake");
  const now = Date.now();
  const res = await wallet.executeBatch({
    creates: [
      {
        payload: jsonToPayload({
          note: "Sourced in bulk from an online channel. Labels reprinted locally.",
          channel: "Telegram seller",
        }),
        contentType: "application/json",
        attributes: {
          type: str("asli.batch"),
          batch_code: str(opts.batchCode),
          drug_code: str(opts.drugCode),
          drug_name: str(opts.drugName),
          status: str("live"),
          units: u64(500),
          exp_at_ms: u64(now + 260 * 86_400_000),
          mfg_at_ms: u64(now),
          city: str(opts.city ?? "Delhi"),
        },
        expires: ExpirationTime.fromDays(120),
      },
      {
        payload: jsonToPayload({
          note: "Bulk deal, no invoice. 50% below MRP.",
        }),
        contentType: "application/json",
        attributes: {
          type: str("asli.custody"),
          batch_code: str(opts.batchCode),
          hop: i32(0),
          city: str(opts.city ?? "Delhi"),
          actor_kind: str("seller"),
          at_ms: u64(now),
        },
        expires: ExpirationTime.fromDays(60),
      },
    ],
  });
  bustReadCache();
  warmAfterWrite(opts.batchCode);
  return {
    txHash: res.txHash as string,
    entityKeys: (res.createdEntities ?? []) as string[],
  };
}

export async function extendByKey(
  role: Role,
  entityKey: string,
  days = EXTENSION_DAYS
) {
  const wallet = walletFor(role);
  const res = await wallet.extendEntity({
    entityKey: entityKey as `0x${string}`,
    // "N more days" added to the *current* deadline — see nextExpiryBlock.
    expires: ExpirationTime.atBlock(await nextExpiryBlock(entityKey, days)),
  });
  bustReadCache();
  warmAfterWrite();
  return { txHash: res.txHash as string, expiresAt: res.expiresAt as bigint };
}
