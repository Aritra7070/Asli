import Link from "next/link";

import DemoPanel from "@/components/DemoPanel";
import LiveFeed from "@/components/LiveFeed";
import SearchBar from "@/components/SearchBar";
import { getCounts, getLatestFeed } from "@/lib/arkiv-server";
import { DEMO } from "@/lib/constants";
import type { FeedItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const WHY = [
  {
    head: "Fakes are everywhere — and brazen",
    body: "Up to 20% of medicines sold in India are estimated to be counterfeit. In 2026 alone: fake cancer drugs reached 90+ hospitals in Bengaluru; a ₹5,000-crore racket in Puducherry; an IPS officer arrested over a ₹3-crore bribe to 'fix' the probe.",
  },
  {
    head: "The risk lands hardest on people buying online",
    body: "10-minute delivery apps dispense to exactly the 15–40 crowd — with recurring 'expired on arrival' complaints. GLP-1 pens (Mounjaro/Ozempic-style) became lifestyle must-haves, and with them came fake pens and a ₹157-crore counterfeit racket.",
  },
  {
    head: "Today's checks can't answer the real question",
    body: "QR codes were mandated on 300+ brands in 2023 and widened to vaccines and cancer drugs in June 2026 — but a QR only shows what the packager printed. A copy carries the same print. Nobody shows you WHO signed for the batch.",
  },
];

export default async function Home() {
  let counts = { batches: 0, scans: 0, flags: 0, registries: 0 };
  let feed: FeedItem[] = [];
  // Both reads in one wave; either may fail while the testnet RPC stalls —
  // the page renders with what came back (the server layer keeps a cache).
  const [c, f] = await Promise.allSettled([getCounts(), getLatestFeed(10)]);
  if (c.status === "fulfilled") counts = c.value;
  if (f.status === "fulfilled") feed = f.value;

  return (
    <div className="mt-10 space-y-10">
      {/* hero */}
      <section>
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Arkiv Global Tour Stop · Best Indian Use Case · Tiramisu testnet
        </div>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          You can photocopy the strip.
          <br />
          <span className="text-emerald-300">You can&apos;t photocopy the proof.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Asli verifies a medicine batch against wallet-signed attestations on
          Arkiv: who stands behind it, where it has travelled, and whether it
          has been recalled — checked live, and impossible to quietly edit.
        </p>
        <div className="mt-6 max-w-2xl">
          <SearchBar />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          Try:
          <Link
            href={`/b/${DEMO.heroCode}`}
            className="mono rounded-full border border-[var(--line)] px-3 py-1 hover:bg-white/5"
          >
            {DEMO.heroCode} · GLP-1 pen
          </Link>
          <Link
            href={`/b/${DEMO.cleanCode}`}
            className="mono rounded-full border border-[var(--line)] px-3 py-1 hover:bg-white/5"
          >
            {DEMO.cleanCode} · clean trace
          </Link>
          <Link
            href={`/b/${DEMO.quickCode}`}
            className="mono rounded-full border border-[var(--line)] px-3 py-1 hover:bg-white/5"
          >
            {DEMO.quickCode} · near-expiry quick-commerce
          </Link>
        </div>
      </section>

      {/* stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Batches attested", counts.batches],
          ["Custody scans", counts.scans],
          ["Flags & recalls", counts.flags],
          ["Registered signers", counts.registries],
        ].map(([label, n]) => (
          <div key={label as string} className="card px-4 py-3">
            <div className="text-2xl font-semibold text-emerald-300">{n as number}</div>
            <div className="text-xs text-[var(--muted)]">{label as string}</div>
          </div>
        ))}
      </section>
      <div className="-mt-7 text-xs text-[var(--muted)]">
        Everything above is live from the chain —{" "}
        <Link href="/radar" className="text-emerald-300 hover:underline">
          open the Radar →
        </Link>
      </div>

      {/* demo + feed */}
      <section className="grid gap-4 lg:grid-cols-2">
        <DemoPanel />
        <LiveFeed initial={feed} />
      </section>

      {/* why */}
      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Why this exists
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.head} className="card p-4">
              <div className="text-sm font-medium">{w.head}</div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                {w.body}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-[var(--muted)]">
          Sources dated Sep–Oct 2026 (Deccan Herald, Indian Express, ICIJ, Reuters, ASPA–CRISIL) —{" "}
          <Link href="/how" className="text-emerald-300 hover:underline">
            see how Asli maps to Arkiv primitives →
          </Link>
        </div>
      </section>
    </div>
  );
}
