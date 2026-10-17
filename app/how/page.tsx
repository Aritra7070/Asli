import Link from "next/link";

import { GITHUB_URL } from "@/lib/constants";

export const metadata = { title: "How it works" };

const SOURCES = [
  {
    label: "Deccan Herald — “Up to 20% drugs sold are counterfeit” (17 Sep 2026)",
    href: "https://www.deccanherald.com/health/healthcare/up-to-20-drugs-sold-are-counterfeit-how-local-pharmacies-are-driving-indias-fake-drug-problem-4149731",
  },
  {
    label: "Insights on India — UPSC editorial analysis on the Bengaluru counterfeit-cancer-drug racket (26 Sep 2026)",
    href: "https://www.insightsonindia.com/2026/09/26/upsc-editorial-analysis-counterfeit-medicines-and-health-system-vulnerabilities/",
  },
  {
    label: "NDTV — 10-minute medicine deliveries worry regulators (2026)",
    href: "https://www.ndtv.com/health/speed-over-safety-10-minute-medicine-deliveries-by-blinkit-zepto-spark-worry-9777352",
  },
  {
    label: "Times Now — “Delivered in 10 minutes, expired on arrival”",
    href: "https://www.timesnownews.com/business-economy/companies/delivered-in-10-minutes-expired-on-arrival-quick-commerces-quality-problem-article-155174912",
  },
];

const PILLARS = [
  [
    "Attestations are wallet-signed — $creator is immutable",
    "A batch claim is an entity whose creator address Arkiv fixes forever. A copy can clone every attribute; it cannot clone the signer. The batch page puts registered and unregistered attestations side by side.",
  ],
  [
    "Custody trail — one entity per handover",
    "Manufacturer → distributor → pharmacy → patient, each hop a signed entity. Public scans are signed by the Asli relay wallet and record city only — never a person.",
  ],
  [
    "Entity Expiration + Lifetime Extension — living records",
    "Each batch entity’s lifetime is tied to the medicine. Every scan performs a Lifetime Extension, so proof stays alive exactly while the medicine keeps moving; if nobody vouches, the record expires on its own.",
  ],
  [
    "readonly + permissionlessExtension — recalls that can't be buried",
    "A recall is write-once: the issuer cannot edit it, and cannot delete it. And because anyone can extend it, a regulator, journalist or citizen can keep the warning alive without the issuer's cooperation.",
  ],
  [
    "u64 range queries — the Expiry Radar",
    "exp_at_ms is a numeric attribute, so “everything expiring within 45 days” is a true range scan — the answer to expired-on-arrival deliveries.",
  ],
  [
    "Live events over WebSocket on top",
    "watchEntityEvents with no fromBlock streams creations, patches, extensions and deletions into the activity feed — judges watch their own clicks land on-chain in real time.",
  ],
];

export default function HowPage() {
  return (
    <div className="mt-10 max-w-3xl space-y-10">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          India already scans QRs dozens of times a day — at every UPI payment.
          Asli points that habit at the thing you actually swallow. The bet is
          simple: <span className="text-[var(--foreground)]">a counterfeit can copy every printed
          detail on the box. It cannot copy a wallet&apos;s signature.</span>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          The problem, dated
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
          <li>
            Up to <span className="text-[var(--foreground)]">20%</span> of medicines sold in India
            are estimated to be counterfeit; the root cause is a lack of
            traceability (Deccan Herald, Sep 2026).
          </li>
          <li>
            Sep 2026: fake cancer drugs and ICU injectables reached{" "}
            <span className="text-[var(--foreground)]">90+ hospitals</span> in Bengaluru — sold at up
            to 50% discount with forged invoices and licences.
          </li>
          <li>
            A ₹5,000-crore counterfeit racket saw an IPS officer arrested in
            2026 over a ₹3-crore bribe to “fix” the probe —{" "}
            <span className="text-[var(--foreground)]">even the referee can be bought</span>, so the
            record must live somewhere nobody can quietly edit.
          </li>
          <li>
            Quick-commerce now dispenses to the 15–40 crowd, with recurring
            “expired on arrival” complaints; fake Mounjaro/Ozempic-style pens
            sold via Instagram/WhatsApp channels (Reuters, Apr 2026).
          </li>
          <li>
            QR codes are mandated on hundreds of brands since 2023 — but a QR
            merely displays what the packager printed, and hospital pharmacies
            rarely verify. A copy passes a print check.
          </li>
        </ul>
        <div className="card space-y-1 p-4 text-xs text-[var(--muted)]">
          {SOURCES.map((s) => (
            <div key={s.href}>
              ·{" "}
              <a href={s.href} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">
                {s.label}
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Every feature maps to an Arkiv primitive
        </h2>
        <div className="space-y-3">
          {PILLARS.map(([head, body]) => (
            <div key={head} className="card p-4">
              <div className="text-sm font-medium">{head}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          What deliberately stays OFF Arkiv
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--muted)]">
          <li>Patient identities, prescriptions, and any personal data — the demo data is synthetic, and public scans record city only.</li>
          <li>Product photographs and large catalogs — Arkiv is the trust layer, not a CDN.</li>
          <li>Private pharmacy inventory — only the events that establish public trust are written.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Verify us without us
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Every claim on this site is reconstructible from the chain alone:
        </p>
        <pre className="mono card overflow-x-auto p-4 text-xs">{`git clone ${GITHUB_URL}
cd asli && npm install
npm run reproduce   # reads Tiramisu directly — no keys, no servers`}</pre>
        <p className="text-xs text-[var(--muted)]">
          Entity design:{" "}
          <a href={`${GITHUB_URL}/blob/main/arkiv/schema.md`} className="text-emerald-300 hover:underline">
            /arkiv/schema.md
          </a>{" "}
          · Friction log:{" "}
          <a href={`${GITHUB_URL}/blob/main/arkiv/friction.md`} className="text-emerald-300 hover:underline">
            /arkiv/friction.md
          </a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-widest text-[var(--muted)]">
          Honest limits
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-[var(--muted)]">
          <li>Registry entries in this demo are self-signed; production needs regulator (state FDA) attestations layered on top.</li>
          <li>The demo write buttons sign with the project&apos;s disposable testnet wallets so anyone can try the flow — real deployments sign with each actor&apos;s own wallet.</li>
          <li>Public-scan writes are relayed and rate-limitable; a production build would issue gasless scan passes per pharmacy.</li>
        </ul>
        <p className="pt-2 text-xs text-[var(--muted)]">
          Start from the{" "}
          <Link href="/" className="text-emerald-300 hover:underline">
            home page
          </Link>{" "}
          or open the{" "}
          <Link href="/radar" className="text-emerald-300 hover:underline">
            Radar
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
