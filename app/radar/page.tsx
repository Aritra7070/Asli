import Link from "next/link";

import { ExtendButton } from "@/components/BatchActions";
import { getRadar } from "@/lib/arkiv-server";
import { cn, fmtDateMs, shorten } from "@/lib/constants";
import type { RadarData } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Radar" };

function daysChip(days: number) {
  const cls =
    days <= 7
      ? "bg-red-500/15 text-red-300"
      : days <= 30
        ? "bg-amber-500/15 text-amber-300"
        : "bg-emerald-500/15 text-emerald-300";
  const label =
    days < 0 ? `expired ${-days}d ago` : days === 0 ? "expires today" : `${days}d left`;
  return <span className={cn("rounded-full px-2 py-0.5 text-xs", cls)}>{label}</span>;
}

export default async function RadarPage() {
  let r: RadarData | null = null;
  let error = "";
  try {
    r = await getRadar(45);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (!r) {
    return (
      <div className="card mt-10 p-6">
        <div className="text-lg font-medium">Radar unavailable</div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Couldn&apos;t read from Arkiv Tiramisu: {error}
        </p>
      </div>
    );
  }

  const maxCity = Math.max(1, ...r.cityCounts.map((c) => c.count));

  return (
    <div className="mt-10 space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Radar</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          What&apos;s about to expire, what&apos;s been recalled, and where
          batches are actually moving — straight off the chain.
        </p>
      </section>

      {/* expiry radar */}
      <section className="card p-5">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Expiring within 45 days
        </h2>
        {r.expiringSoon.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Nothing near expiry right now.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">Batch</th>
                  <th className="pb-2 pr-4 font-medium">Drug</th>
                  <th className="pb-2 pr-4 font-medium">Printed expiry</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Attested by</th>
                </tr>
              </thead>
              <tbody>
                {r.expiringSoon.map((b) => (
                  <tr key={`${b.code}-${b.creator}`} className="border-t border-[var(--line)]">
                    <td className="py-2.5 pr-4">
                      <Link
                        href={`/b/${b.code}`}
                        className="mono text-emerald-300 hover:underline"
                      >
                        {b.code}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">{b.drugName ?? "—"}</td>
                    <td className="py-2.5 pr-4">
                      {b.expAtMs ? fmtDateMs(b.expAtMs) : "—"}
                    </td>
                    <td className="py-2.5 pr-4">{daysChip(b.daysLeft)}</td>
                    <td className="mono py-2.5 text-xs text-[var(--muted)]">
                      {shorten(b.creator)}
                      {b.canonical ? " ✓" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mono mt-4 text-[11px] text-[var(--muted)]">
          query: select().where(and(type = str(&quot;batch&quot;), exp_at_ms &lt;= u64(now + 45d)))
          — a range scan over a numeric attribute
        </div>
      </section>

      {/* recalls */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Live recalls
        </h2>
        {r.recalls.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No recalls on the chain right now.</p>
        ) : (
          r.recalls.map((f) => (
            <div key={f.entityKey} className="card border-red-500/40 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                  SEVERITY {f.severity}
                </span>
                {f.batchCode && (
                  <Link
                    href={`/b/${f.batchCode}`}
                    className="mono text-xs text-emerald-300 hover:underline"
                  >
                    batch {f.batchCode} →
                  </Link>
                )}
                <span className="mono text-xs text-[var(--muted)]">
                  {f.atMs ? fmtDateMs(f.atMs) : ""}
                </span>
              </div>
              <div className="mt-2 text-sm font-medium">{f.title}</div>
              <p className="mt-1 text-xs text-[var(--muted)]">{f.detail}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ExtendButton entityKey={f.entityKey} />
              </div>
            </div>
          ))
        )}
      </section>

      {/* city activity */}
      <section className="card p-5">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Where scans are happening
        </h2>
        <div className="mt-3 space-y-2">
          {r.cityCounts.length === 0 && (
            <p className="text-sm text-[var(--muted)]">No custody scans yet.</p>
          )}
          {r.cityCounts.map((c) => (
            <div key={c.city} className="flex items-center gap-3 text-sm">
              <span className="w-24 text-xs text-[var(--muted)]">{c.city}</span>
              <span className="h-2 rounded-full bg-emerald-500/50" style={{ width: `${(c.count / maxCity) * 240}px` }} />
              <span className="text-xs text-[var(--muted)]">{c.count} scans</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Batches", r.totals.batches],
          ["Custody scans", r.totals.scans],
          ["Flags", r.totals.flags],
          ["Registries", r.totals.registries],
        ].map(([label, n]) => (
          <div key={label as string} className="card px-4 py-3">
            <div className="text-xl font-semibold">{n as number}</div>
            <div className="text-xs text-[var(--muted)]">{label as string}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
