import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { BatchActions, ExtendButton } from "@/components/BatchActions";
import { getBatchReport } from "@/lib/arkiv-server";
import {
  DEMO,
  VERDICT_COPY,
  blockToDate,
  cn,
  fmtDateMs,
  shorten,
  timeAgo,
} from "@/lib/constants";
import type { Attestation, BatchReport, Registry } from "@/lib/types";

export const dynamic = "force-dynamic";

const getReport = cache(getBatchReport);

const STYLE: Record<
  BatchReport["verdict"]["kind"],
  { glow: string; text: string; border: string; chip: string; emoji: string }
> = {
  verified: {
    glow: "glow-green",
    text: "text-emerald-300",
    border: "border-emerald-500/50",
    chip: "bg-emerald-500/15 text-emerald-300",
    emoji: "✅",
  },
  unverified: {
    glow: "glow-amber",
    text: "text-amber-300",
    border: "border-amber-500/50",
    chip: "bg-amber-500/15 text-amber-300",
    emoji: "⚠️",
  },
  counterfeit: {
    glow: "glow-red",
    text: "text-red-300",
    border: "border-red-500/50",
    chip: "bg-red-500/15 text-red-300",
    emoji: "🚨",
  },
  recalled: {
    glow: "glow-red",
    text: "text-red-300",
    border: "border-red-500/50",
    chip: "bg-red-500/15 text-red-300",
    emoji: "🚨",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).toUpperCase();
  try {
    const r = await getReport(code);
    if (!r.found) {
      return {
        title: `${code} — no attestation found`,
        description: `No registered wallet has vouched for batch ${code} on Arkiv. That absence is itself a warning — check before you buy.`,
      };
    }
    const v = VERDICT_COPY[r.verdict.kind];
    const s = STYLE[r.verdict.kind];
    const desc = `${s.emoji} ${v.label} · ${r.verdict.registeredSigners} registered signer(s) · ${r.stats.scans} custody scans · ${r.flags.length} flag(s). Checked live on Arkiv by Asli.`;
    return {
      title: `${code} — ${v.label}`,
      description: desc,
      openGraph: { title: `Asli · batch ${code}`, description: desc },
    };
  } catch {
    return { title: `${code}` };
  }
}

function shortTimeAgo(ms?: number): string {
  return ms ? timeAgo(ms) : "—";
}

function AttestationCard({
  a,
  head,
  registry,
}: {
  a: Attestation;
  head: bigint;
  registry?: Registry;
}) {
  const createdDate = new Date(
    Date.now() - Number(head - a.createdAtBlock) * 2000
  );
  const trusted = !!registry;
  return (
    <div
      className={cn(
        "card-2 p-4",
        trusted
          ? "border-emerald-500/40"
          : "border-red-500/40"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {trusted ? (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            ✓ REGISTERED · {registry.name}
          </span>
        ) : (
          <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-300">
            ⚠ UNREGISTERED WALLET
          </span>
        )}
        {a.canonical && (
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--muted)]">
            canonical attestation
          </span>
        )}
        {registry && (
          <span className="text-xs text-[var(--muted)]">
            {registry.role} · {registry.city}
          </span>
        )}
        {!registry && (
          <span className="text-xs text-red-300/80">
            no registry entry — nobody in the supply chain recognises this signer
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <div className="text-[var(--muted)]">$creator (immutable)</div>
          <div className="mono truncate" title={a.creator}>
            {a.creator}
          </div>
        </div>
        <div>
          <div className="text-[var(--muted)]">Attested</div>
          <div>{fmtDateMs(createdDate.getTime())}</div>
        </div>
        <div>
          <div className="text-[var(--muted)]">City on labels</div>
          <div>{a.city ?? "—"}</div>
        </div>
        <div>
          <div className="text-[var(--muted)]">Units claimed</div>
          <div>{a.units?.toLocaleString("en-IN") ?? "—"}</div>
        </div>
        <div>
          <div className="text-[var(--muted)]">Printed drug expiry</div>
          <div>{a.expAtMs ? fmtDateMs(a.expAtMs) : "—"}</div>
        </div>
        <div>
          <div className="text-[var(--muted)]">Drug code</div>
          <div className="mono">{a.drugCode ?? "—"}</div>
        </div>
      </div>

      {typeof a.payload?.note === "string" && (
        <p className="mt-3 text-xs italic text-[var(--muted)]">
          “{a.payload.note as string}”
        </p>
      )}
    </div>
  );
}

export default async function BatchPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).toUpperCase();

  let r: BatchReport;
  try {
    r = await getReport(code);
  } catch (e) {
    return (
      <div className="card mt-10 p-6">
        <div className="text-lg font-medium">Couldn&apos;t reach Arkiv Tiramisu</div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {e instanceof Error ? e.message : String(e)}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          The public testnet shares a read budget that is sometimes exhausted
          — retry in a moment. The demo batches below are always served from
          the last synced copy:
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href={`/b/${DEMO.heroCode}`} className="rounded-lg border border-[var(--line)] px-3 py-1.5 hover:bg-white/5">
            {DEMO.heroCode}
          </Link>
          <Link href={`/b/${DEMO.cleanCode}`} className="rounded-lg border border-[var(--line)] px-3 py-1.5 hover:bg-white/5">
            {DEMO.cleanCode}
          </Link>
          <Link href={`/b/${DEMO.quickCode}`} className="rounded-lg border border-[var(--line)] px-3 py-1.5 hover:bg-white/5">
            {DEMO.quickCode}
          </Link>
        </div>
      </div>
    );
  }

  if (!r.found) {
    return (
      <div className="mt-10">
        <div className="card glow-amber border-amber-500/40 p-6">
          <div className="text-xs uppercase tracking-widest text-[var(--muted)]">
            No attestation on Arkiv
          </div>
          <h1 className="mono mt-2 text-2xl">{code}</h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
            Nobody has vouched for this batch on Arkiv — no manufacturer, no
            distributor, no pharmacy. If you typed the code from a strip,
            double-check it. If it is correct, this silence is already an
            answer: <span className="text-amber-300">do not trust it until someone signs for it</span>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Link href={`/b/${DEMO.heroCode}`} className="rounded-lg border border-[var(--line)] px-3 py-1.5 hover:bg-white/5">
              Try the demo batch {DEMO.heroCode}
            </Link>
            <Link href={`/b/${DEMO.quickCode}`} className="rounded-lg border border-[var(--line)] px-3 py-1.5 hover:bg-white/5">
              Try the quick-commerce batch {DEMO.quickCode}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const s = STYLE[r.verdict.kind];
  const v = VERDICT_COPY[r.verdict.kind];
  const canonical = r.attestations.find((a) => a.canonical);
  const recalls = r.flags.filter((f) => f.kind === "recall");
  const reports = r.flags.filter((f) => f.kind !== "recall");
  const drugName = r.attestations.find((a) => a.drugName)?.drugName;

  return (
    <div className="mt-8 space-y-6">
      {/* verdict banner */}
      <section className={cn("card p-6", s.glow, s.border)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-[var(--muted)]">
              {drugName ?? "Batch verification"}
            </div>
            <h1 className="mono mt-1 text-3xl">{code}</h1>
          </div>
          <div className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", s.chip)}>
            {s.emoji} {v.label}
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">{v.blurb}</p>
        <div className="mono mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--muted)]">
          <span>
            registered signers:{" "}
            <span className="text-emerald-300">{r.verdict.registeredSigners}</span>
          </span>
          <span>
            unregistered: <span className="text-red-300">{r.verdict.unregisteredSigners}</span>
          </span>
          <span>custody scans: {r.stats.scans}</span>
          <span>cities: {r.stats.cities.join(" → ") || "—"}</span>
          <span suppressHydrationWarning>
            last activity: {shortTimeAgo(r.stats.lastActivityMs)}
          </span>
        </div>
      </section>

      {/* counterfeit contrast */}
      {r.verdict.kind === "counterfeit" && (
        <section className="card glow-red border-red-500/40 p-5">
          <div className="text-sm font-semibold text-red-300">
            🚨 Copy detected — two wallets claim this batch code
          </div>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            A counterfeiter can clone every printed attribute — the batch code,
            the MRP, the hologram, even the QR. What no one can clone is the{" "}
            <span className="mono text-[var(--foreground)]">$creator</span> signature:
            Arkiv fixes it at creation and never lets it change. One of the
            attestations below was written by a registered supply-chain wallet.
            The other was written by a wallet nobody recognises.
          </p>
        </section>
      )}

      {/* who signed */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Who signed for this batch
        </h2>
        {r.attestations.map((a) => (
          <AttestationCard
            key={a.entityKey}
            a={a}
            head={r.head}
            registry={r.registries[a.creator.toLowerCase()]}
          />
        ))}
      </section>

      {/* custody trail */}
      {r.trail.length > 0 && (
        <section className="card p-5">
          <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
            Custody trail — signed at every handover
          </h2>
          <ol className="mt-4 space-y-0 border-l border-[var(--line)]">
            {r.trail.map((t) => {
              const reg = r.registries[t.creator.toLowerCase()];
              return (
                <li key={t.entityKey} className="relative ml-4 pb-5 last:pb-0">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <div className="text-sm">
                    <span className="text-[var(--muted)]">hop {t.hop ?? "?"} · </span>
                    {t.actorKind ?? "scan"}
                    {t.city ? <span className="text-[var(--muted)]"> @ {t.city}</span> : null}
                  </div>
                  {t.note && (
                    <div className="mt-0.5 text-xs text-[var(--muted)]">“{t.note}”</div>
                  )}
                  <div className="mono mt-0.5 text-[11px] text-[var(--muted)]">
                    {reg ? `${reg.name} ✓` : shorten(t.creator)} ·{" "}
                    {t.atMs ? fmtDateMs(t.atMs) : `≈ ${fmtDateMs(Date.now() - Number(r.head - t.createdAtBlock) * 2000)}`}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* recalls */}
      {recalls.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
            Recalls — write-once, cannot be taken down
          </h2>
          {recalls.map((f) => (
            <div key={f.entityKey} className="card glow-red border-red-500/40 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                  SEVERITY {f.severity}
                </span>
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--muted)]">
                  readonly — frozen at creation
                </span>
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--muted)]">
                  anyone can renew it — the issuer cannot delete it
                </span>
              </div>
              <div className="mt-3 text-sm font-medium">{f.title}</div>
              <p className="mt-1 text-sm text-[var(--muted)]">{f.detail}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                <span className="mono">
                  issued by {r.registries[f.creator.toLowerCase()]?.name ?? shorten(f.creator)}
                  {f.atMs ? ` · ${fmtDateMs(f.atMs)}` : ""}
                </span>
                <ExtendButton entityKey={f.entityKey} />
              </div>
            </div>
          ))}
        </section>
      )}

      {/* reports */}
      {reports.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
            Community reports
          </h2>
          {reports.map((f) => (
            <div key={f.entityKey} className="card-2 border-amber-500/30 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-300">
                  {f.kind.replace("_", " ")} · severity {f.severity}
                </span>
                <span className="text-[var(--muted)]">
                  {f.atMs ? fmtDateMs(f.atMs) : ""} · signed by{" "}
                  {r.registries[f.creator.toLowerCase()]?.name ?? shorten(f.creator)}
                </span>
              </div>
              {f.title && <div className="mt-2 text-sm">{f.title}</div>}
              {f.detail && (
                <p className="mt-1 text-xs text-[var(--muted)]">{f.detail}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* living record */}
      {canonical && (
        <section className="card p-5">
          <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
            Living record
          </h2>
          <div className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-[var(--muted)]">The medicine expires</div>
              <div>{canonical.expAtMs ? fmtDateMs(canonical.expAtMs) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">This record stays alive until ≈</div>
              <div>{fmtDateMs(blockToDate(canonical.expiresAtBlock, r.head).getTime())}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">Entity Expiration</div>
              <div className="text-xs text-[var(--muted)]">
                created with{" "}
                <span className="mono text-emerald-300">permissionlessExtension</span>
              </div>
            </div>
          </div>
          <p className="mt-3 max-w-3xl text-xs text-[var(--muted)]">
            Every scan along the way performs a Lifetime Extension — a pharmacist
            confirming stock literally keeps the proof alive. If the medicine stops
            moving and stops being vouched for, its record expires on its own. The
            data lifecycle mirrors the physical lifecycle.
          </p>
        </section>
      )}

      {/* actions */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Act on this batch (real transactions)
        </h2>
        <BatchActions code={code} />
      </section>
    </div>
  );
}
