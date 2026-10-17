#!/usr/bin/env node
// Asli — seed the synthetic demo world on Arkiv Tiramisu.
//
// Creates, in order:
//   - 5 self-signed registry entries (manufacturer, distributor, 2 pharmacies, 1 relay)
//     deliberately none for the counterfeiter wallet
//   - The hero batch (Glucofine 5 pen) with a 4-hop signed custody trail
//   - A counterfeit copy of the same batch code signed by the unregistered wallet
//   - The quick-commerce batch (Feverex 650) near expiry, with dark-store custody
//   - An immutable, permissionless recall on the quick-commerce batch
//
// Usage: npm run seed        (requires funded signers — see `npm run wallets:new`)

import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  jsonToPayload,
} from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { addr, bool, i32, str, u64 } from "@arkiv-network/sdk/attr";
import { and, eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

const RPC_URL = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
const DAY = 86_400_000;

const ENV_PATH = ".env.local";
if (!existsSync(ENV_PATH)) {
  console.error("Missing .env.local — run `npm run wallets:new` first.");
  process.exit(1);
}
const env = readFileSync(ENV_PATH, "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(\\S+)`, "m"))?.[1];

const ROLES = {
  mfr: "ASLI_MFR_PRIVATE_KEY",
  dist: "ASLI_DIST_PRIVATE_KEY",
  reliant: "ASLI_RELIANT_PRIVATE_KEY",
  qm: "ASLI_QM_PRIVATE_KEY",
  relay: "ASLI_RELAY_PRIVATE_KEY",
  fake: "ASLI_FAKE_PRIVATE_KEY",
};

const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(RPC_URL),
});

const wallets = {};
for (const [role, key] of Object.entries(ROLES)) {
  const pk = get(key);
  if (!pk) {
    console.error(`Missing ${key} in .env.local — run \`npm run wallets:new\`.`);
    process.exit(1);
  }
  wallets[role] = createWalletClient({
    chain: tiramisu,
    transport: http(RPC_URL),
    account: privateKeyToAccount(pk, { nonceManager }),
  });
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// ------------------------------------------------- idempotency & renewals

const BLOCKS_PER_DAY = 43_200n; // the SDK resolves lifetimes at a 2s block time
const EXTENSION_DAYS = 30n;
const EXT = EXTENSION_DAYS * BLOCKS_PER_DAY; // blocks added per interaction

// Re-running the seed must not duplicate the world, and a crashed run must be
// resumable: every write below first asks the chain whether that record
// already exists (same type + batch code, created by the same signer).
async function findMine(where, wallet, match) {
  const page = await publicClient.select("*").where(where).limit(200).fetch();
  return page.entities.find(
    (e) =>
      e.creator?.toLowerCase() === wallet.account.address.toLowerCase() &&
      (match ? match(e) : true)
  );
}
const attrValue = (e, name) => e.attributes?.[name]?.value;

// An extension *sets* the deadline and the engine rejects a shortening, so
// renewal targets are computed from the entity's CURRENT expiry — never from
// "now": creating pinned a batch to its printed expiry (e.g. 2027-06-30),
// which sits far beyond "now + 30 days".
async function renewal(entityKey) {
  const { expiresAt } = await publicClient.getEntity(entityKey);
  return ExpirationTime.atBlock(BigInt(expiresAt) + EXT);
}

// ---------------------------------------------------------------- preflight

console.log("\nChecking signer balances…");
for (const [role, w] of Object.entries(wallets)) {
  const bal = await publicClient.getBalance({ address: w.account.address });
  const glm = Number(bal) / 1e18;
  console.log(`  ${role.padEnd(8)} ${w.account.address}  ${glm.toFixed(4)} GLM`);
  if (bal === 0n) {
    console.error(
      `\nSigner "${role}" has 0 GLM. Fund the demo signers first:\n` +
        `  - add FUNDER_PRIVATE_KEY to .env.local, then run: npm run wallets:fund\n` +
        `  - faucet: https://hub.arkiv.network/faucet\n`
    );
    process.exit(1);
  }
}

let n = 0;
const step = (msg) => console.log(`  ${String(++n).padStart(2, "0")}. ${msg}`);

// ---------------------------------------------------------------- registry

console.log("\n1) Registries (self-signed — no registry entry for the counterfeiter)");
const registries = [
  ["mfr", { name: "Aushadh Labs", role: "manufacturer", city: "Hyderabad" }],
  ["dist", { name: "MedRoute Logistics", role: "distributor", city: "Mumbai" }],
  ["reliant", { name: "Reliant Pharmacy", role: "pharmacy", city: "Pune" }],
  ["qm", { name: "QuickMeds Hub", role: "pharmacy", city: "Gurugram" }],
  ["relay", { name: "Asli Public Scan Relay", role: "relay", city: "Multi-city" }],
];
const registryKeys = {};
for (const [role, info] of registries) {
  const w = wallets[role];
  const existing = await findMine(eq("type", str("asli.registry")), w);
  if (existing) {
    registryKeys[role] = existing.key;
    step(`registry · ${info.name} (${role}) · already on-chain, skipping`);
    continue;
  }
  const res = await w.createEntity({
    payload: jsonToPayload({
      note: "Self-signed registry entry. In production a regulator (e.g. a state FDA) would also attest these.",
    }),
    contentType: "application/json",
    attributes: {
      type: str("asli.registry"),
      wallet_addr: addr(w.account.address),
      name: str(info.name),
      role: str(info.role),
      city: str(info.city),
      since_ms: u64(Date.now()),
    },
    expires: ExpirationTime.fromYears(2),
  });
  registryKeys[role] = res.entityKey;
  step(`registry · ${info.name} (${role}) · ${res.entityKey.slice(0, 12)}…`);
}

// ---------------------------------------------------------------- hero batch

console.log("\n2) Hero batch — Glucofine 5 pen (the GLP-1 story)");
const heroExp = new Date("2027-06-30T00:00:00Z").getTime();
const heroExisting = await findMine(
  and(eq("type", str("asli.batch")), eq("batch_code", str("GF5-26A-0142"))),
  wallets.mfr
);
let heroKey;
if (heroExisting) {
  heroKey = heroExisting.key;
  step(`hero batch attested by MFR · already on-chain, skipping`);
} else {
  const heroBatch = await wallets.mfr.createEntity({
    payload: jsonToPayload({
      form: "Pre-filled injection pen",
      note: "Synthetic demo product. Cold-chain distributed.",
    }),
    contentType: "application/json",
    attributes: {
      type: str("asli.batch"),
      batch_code: str("GF5-26A-0142"),
      drug_code: str("GF5-PEN-5MG"),
      drug_name: str("Glucofine 5 pen (synthetic)"),
      status: str("live"),
      canonical: bool(true),
      units: u64(1200),
      exp_at_ms: u64(heroExp),
      mfg_at_ms: u64(Date.now() - 40 * DAY),
      city: str("Hyderabad"),
    },
    // Living Records: the record is tied to the medicine's own expiry, with a
    // floor so it survives the judging window; any supply-chain wallet can
    // extend it on a scan (permissionlessExtension).
    expires: ExpirationTime.atDate(new Date(heroExp), {
      atLeast: ExpirationTime.fromDays(150),
    }),
    flags: { permissionlessExtension: true },
  });
  heroKey = heroBatch.entityKey;
  step(`hero batch attested by MFR · ${heroBatch.entityKey.slice(0, 12)}…`);
}

const hops = [
  ["mfr", { hop: 0, city: "Hyderabad", actor: "manufacturer", note: "Batch released. Tamper-evident labels applied at the line." }],
  ["dist", { hop: 1, city: "Mumbai", actor: "distributor", note: "1,200 units received at the cold-chain hub." }],
  ["reliant", { hop: 2, city: "Pune", actor: "pharmacy", note: "Pharmacy intake — batch matched to the manufacturer attestation." }],
  ["relay", { hop: 3, city: "Pune", actor: "public", note: "Patient verified authenticity before purchase." }],
];
for (const [role, h] of hops) {
  const w = wallets[role];
  const already = await findMine(
    and(eq("type", str("asli.custody")), eq("batch_code", str("GF5-26A-0142"))),
    w,
    (e) => Number(attrValue(e, "hop")) === h.hop
  );
  if (already) {
    step(`custody hop ${h.hop} · ${role} · already on-chain, skipping`);
    continue;
  }
  const res = await w.executeBatch({
    creates: [
      {
        payload: jsonToPayload({ note: h.note }),
        contentType: "application/json",
        attributes: {
          type: str("asli.custody"),
          batch_code: str("GF5-26A-0142"),
          hop: i32(h.hop),
          city: str(h.city),
          actor_kind: str(h.actor),
          at_ms: u64(Date.now() - (4 - h.hop) * 6 * DAY),
        },
        expires: ExpirationTime.fromDays(60),
      },
    ],
    // One atomic tx: the hop is recorded AND the batch's record earns another
    // 30 days of life — a Lifetime Extension on every verified interaction.
    extensions: [{ entityKey: heroKey, expires: await renewal(heroKey) }],
  });
  step(`custody hop ${h.hop} · ${role} · ${res.txHash.slice(0, 12)}…`);
}

// A public report about lookalikes of the hero batch (relay, low severity).
const heroReportExisting = await findMine(
  and(eq("type", str("asli.flag")), eq("batch_code", str("GF5-26A-0142"))),
  wallets.relay,
  (e) => attrValue(e, "kind") === "counterfeit_report"
);
if (heroReportExisting) {
  step(`public counterfeit report · already on-chain, skipping`);
} else {
  const heroReport = await wallets.relay.createEntity({
    payload: jsonToPayload({
      title: "Lookalike units offered at a Delhi seller",
      detail:
        "Synthetic demo report: pen boxes for this batch code seen 50% below MRP on an unregistered channel. Signer is not a registered pharmacy.",
    }),
    contentType: "application/json",
    attributes: {
      type: str("asli.flag"),
      batch_code: str("GF5-26A-0142"),
      kind: str("counterfeit_report"),
      severity: i32(2),
      at_ms: u64(Date.now() - 2 * DAY),
      city: str("Delhi"),
    },
    expires: ExpirationTime.fromDays(200),
    flags: { readonly: true, permissionlessExtension: true },
  });
  step(`public counterfeit report · ${heroReport.entityKey.slice(0, 12)}…`);
}

// ---------------------------------------------------------------- clean batch

console.log("3) A clean batch — the happy path (green verdict)");
const cleanExp = new Date("2028-01-31T00:00:00Z").getTime();
const cleanExisting = await findMine(
  and(eq("type", str("asli.batch")), eq("batch_code", str("AMX-500-26C-0311"))),
  wallets.mfr
);
let cleanKey;
if (cleanExisting) {
  cleanKey = cleanExisting.key;
  step(`clean batch attested by MFR · already on-chain, skipping`);
} else {
  const cleanBatch = await wallets.mfr.createEntity({
    payload: jsonToPayload({
      form: "Tablet (strip of 10)",
      note: "Synthetic demo product. Full custody trail, no flags.",
    }),
    contentType: "application/json",
    attributes: {
      type: str("asli.batch"),
      batch_code: str("AMX-500-26C-0311"),
      drug_code: str("AMX-500-TAB"),
      drug_name: str("Amoxa 500 (synthetic)"),
      status: str("live"),
      canonical: bool(true),
      units: u64(3000),
      exp_at_ms: u64(cleanExp),
      mfg_at_ms: u64(Date.now() - 90 * DAY),
      city: str("Hyderabad"),
    },
    expires: ExpirationTime.atDate(new Date(cleanExp), {
      atLeast: ExpirationTime.fromDays(150),
    }),
    flags: { permissionlessExtension: true },
  });
  cleanKey = cleanBatch.entityKey;
  step(`clean batch attested by MFR · ${cleanBatch.entityKey.slice(0, 12)}…`);
}

const cleanHops = [
  ["mfr", { hop: 0, city: "Hyderabad", actor: "manufacturer", note: "Batch released after QC clearance." }],
  ["dist", { hop: 1, city: "Mumbai", actor: "distributor", note: "3,000 strips received at the hub." }],
  ["reliant", { hop: 2, city: "Pune", actor: "pharmacy", note: "Shelf intake — matched to the manufacturer attestation." }],
  ["relay", { hop: 3, city: "Pune", actor: "public", note: "Buyer scan at the counter — signatures verified." }],
];
for (const [role, h] of cleanHops) {
  const w = wallets[role];
  const already = await findMine(
    and(eq("type", str("asli.custody")), eq("batch_code", str("AMX-500-26C-0311"))),
    w,
    (e) => Number(attrValue(e, "hop")) === h.hop
  );
  if (already) {
    step(`custody hop ${h.hop} · ${role} · already on-chain, skipping`);
    continue;
  }
  const res = await w.executeBatch({
    creates: [
      {
        payload: jsonToPayload({ note: h.note }),
        contentType: "application/json",
        attributes: {
          type: str("asli.custody"),
          batch_code: str("AMX-500-26C-0311"),
          hop: i32(h.hop),
          city: str(h.city),
          actor_kind: str(h.actor),
          at_ms: u64(Date.now() - (4 - h.hop) * 5 * DAY),
        },
        expires: ExpirationTime.fromDays(60),
      },
    ],
    extensions: [{ entityKey: cleanKey, expires: await renewal(cleanKey) }],
  });
  step(`custody hop ${h.hop} · ${role} · ${res.txHash.slice(0, 12)}…`);
}

// ---------------------------------------------------------------- counterfeit copy

console.log("\n4) The counterfeit copy — same batch code, unregistered signer");
const fakeExisting = await findMine(
  and(eq("type", str("asli.batch")), eq("batch_code", str("GF5-26A-0142"))),
  wallets.fake
);
const fakeHopExisting = await findMine(
  and(eq("type", str("asli.custody")), eq("batch_code", str("GF5-26A-0142"))),
  wallets.fake,
  (e) => Number(attrValue(e, "hop")) === 0
);
if (fakeExisting && fakeHopExisting) {
  step(`counterfeit copy + seller hop by UNREGISTERED wallet · already on-chain, skipping`);
} else {
  const fakeRes = await wallets.fake.executeBatch({
    creates: [
      {
        payload: jsonToPayload({
          note: "Sourced in bulk from an online channel. Labels reprinted locally.",
          channel: "Telegram seller",
        }),
        contentType: "application/json",
        attributes: stripUndefined({
          type: str("asli.batch"),
          batch_code: str("GF5-26A-0142"),
          drug_code: str("GF5-PEN-5MG"),
          drug_name: str("Glucofine 5 pen (synthetic)"),
          status: str("live"),
          units: u64(500),
          exp_at_ms: u64(heroExp),
          mfg_at_ms: u64(Date.now()),
          city: str("Delhi"),
        }),
        expires: ExpirationTime.fromDays(120),
      },
      {
        payload: jsonToPayload({ note: "Bulk deal, no invoice. 50% below MRP." }),
        contentType: "application/json",
        attributes: {
          type: str("asli.custody"),
          batch_code: str("GF5-26A-0142"),
          hop: i32(0),
          city: str("Delhi"),
          actor_kind: str("seller"),
          at_ms: u64(Date.now() - 1 * DAY),
        },
        expires: ExpirationTime.fromDays(60),
      },
    ],
  });
  step(`counterfeit copy + seller hop by UNREGISTERED wallet · ${fakeRes.txHash.slice(0, 12)}…`);
}

// ---------------------------------------------------------------- quick-commerce batch

console.log("\n5) Quick-commerce batch — Feverex 650 (the 10-minute delivery story)");
const quickExp = Date.now() + 26 * DAY; // expires in ~26 days
const quickExisting = await findMine(
  and(eq("type", str("asli.batch")), eq("batch_code", str("FX650-25J-0881"))),
  wallets.mfr
);
let quickKey;
if (quickExisting) {
  quickKey = quickExisting.key;
  step(`quick batch attested by MFR · already on-chain, skipping`);
} else {
  const quickBatch = await wallets.mfr.createEntity({
    payload: jsonToPayload({
      form: "Tablet (strip of 10)",
      note: "Synthetic demo product. High-volume OTC painkiller.",
    }),
    contentType: "application/json",
    attributes: {
      type: str("asli.batch"),
      batch_code: str("FX650-25J-0881"),
      drug_code: str("FX650-TAB"),
      drug_name: str("Feverex 650 (synthetic)"),
      status: str("live"),
      canonical: bool(true),
      units: u64(8000),
      exp_at_ms: u64(quickExp),
      mfg_at_ms: u64(Date.now() - 320 * DAY),
      city: str("Hyderabad"),
    },
    expires: ExpirationTime.atDate(new Date(quickExp), {
      atLeast: ExpirationTime.fromDays(150),
    }),
    flags: { permissionlessExtension: true },
  });
  quickKey = quickBatch.entityKey;
  step(`quick batch attested by MFR · ${quickBatch.entityKey.slice(0, 12)}…`);
}

const quickHops = [
  ["mfr", { hop: 0, city: "Hyderabad", actor: "manufacturer", note: "Batch released for national distribution." }],
  ["qm", { hop: 1, city: "Gurugram", actor: "pharmacy", note: "Dark-store intake, 8,000 units." }],
  ["qm", { hop: 2, city: "Gurugram", actor: "pharmacy", note: "Dispensed to app order #QM-88231." }],
  ["relay", { hop: 3, city: "Gurugram", actor: "public", note: "Customer scanned the strip on delivery — 26 days to expiry." }],
];
for (const [role, h] of quickHops) {
  const w = wallets[role];
  const already = await findMine(
    and(eq("type", str("asli.custody")), eq("batch_code", str("FX650-25J-0881"))),
    w,
    (e) => Number(attrValue(e, "hop")) === h.hop
  );
  if (already) {
    step(`custody hop ${h.hop} · ${role} · already on-chain, skipping`);
    continue;
  }
  const res = await w.executeBatch({
    creates: [
      {
        payload: jsonToPayload({ note: h.note }),
        contentType: "application/json",
        attributes: {
          type: str("asli.custody"),
          batch_code: str("FX650-25J-0881"),
          hop: i32(h.hop),
          city: str(h.city),
          actor_kind: str(h.actor),
          at_ms: u64(Date.now() - (4 - h.hop) * 3 * DAY),
        },
        expires: ExpirationTime.fromDays(60),
      },
    ],
    extensions: [{ entityKey: quickKey, expires: await renewal(quickKey) }],
  });
  step(`custody hop ${h.hop} · ${role} · ${res.txHash.slice(0, 12)}…`);
}

console.log("\n6) Recall — write-once, and anyone can keep it alive");
const recallExisting = await findMine(
  and(eq("type", str("asli.flag")), eq("batch_code", str("FX650-25J-0881"))),
  wallets.mfr,
  (e) => attrValue(e, "kind") === "recall"
);
let recallKey;
if (recallExisting) {
  recallKey = recallExisting.key;
  step(`recall flag by MFR · already on-chain, skipping`);
} else {
  const recall = await wallets.mfr.createEntity({
    payload: jsonToPayload({
      title: "Mislabelled-expiry units found in this batch",
      detail:
        "Routine QC found a sub-lot with a printed expiry later than actual. Do not dispense sub-lot J-0881/2. Synthetic demo recall.",
    }),
    contentType: "application/json",
    attributes: {
      type: str("asli.flag"),
      batch_code: str("FX650-25J-0881"),
      kind: str("recall"),
      severity: i32(4),
      at_ms: u64(Date.now() - 1 * DAY),
      city: str("Hyderabad"),
    },
    expires: ExpirationTime.fromDays(200),
    flags: { readonly: true, permissionlessExtension: true },
  });
  recallKey = recall.entityKey;
  step(`recall flag by MFR · ${recall.entityKey.slice(0, 12)}…`);
}

// ---------------------------------------------------------------- summary

console.log("\nDone. The demo world is live on Tiramisu:\n");
console.log(`  Hero batch          GF5-26A-0142  key ${heroKey}`);
console.log(`  Clean batch         AMX-500-26C-0311  key ${cleanKey}`);
console.log(`  Quick batch         FX650-25J-0881  key ${quickKey}`);
console.log(`  Recall flag         key ${recallKey}`);
console.log("");
console.log("Verify from the chain alone (no keys needed): npm run reproduce");
console.log("Then start the app: npm run dev  →  open /b/GF5-26A-0142\n");
