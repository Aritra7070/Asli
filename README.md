# Asli — असली — the honest scan for medicine

**You can photocopy the strip. You can't photocopy the proof.**

Asli verifies a medicine batch against **wallet-signed attestations on
[Arkiv](https://arkiv.network)** (Tiramisu testnet): who stands behind it,
where it has travelled, and whether it has been recalled — checked live, and
impossible to quietly edit.

Built for the **Arkiv: Global Tour Stop** (Devcon 8), competing in
**Best Indian Use Case**, **Censorship Resistance** and **Security**.

---

## The problem, dated (all of this really happened)

- Up to **20% of medicines sold in India** are estimated counterfeit; the root
  cause named is a lack of traceability — *Deccan Herald, 17 Sep 2026*.
- Sep 2026: fake **cancer drugs and ICU injectables reached 90+ hospitals in
  Bengaluru**, with forged invoices and licences, sold at 50% discount.
- A **₹5,000-crore counterfeit racket** saw an IPS officer arrested over a
  **₹3-crore bribe to "fix" the probe** — even the referee can be bought.
- **Quick-commerce** now dispenses to the 15–40 crowd with recurring
  "expired on arrival" complaints; **fake GLP-1 pens** (Mounjaro/Ozempic-style)
  sell via Instagram/WhatsApp channels — *Reuters, Apr 2026*.
- QR codes are mandated on 300+ brands since 2023 (widened to vaccines and
  cancer drugs in June 2026) — but a QR only shows **what the packager
  printed**. A copy carries the same print.

## What Asli does

| Feature | One line |
|---|---|
| **Counterfeit Contrast** | Two wallets claim the same batch code → the page puts them side by side: one registered, one not. `$creator` is immutable on Arkiv; a copy can't clone the signer. |
| **Scan Trail** | Every handover is a signed entity — manufacturer → distributor → pharmacy → patient (public scans are city-level, no personal data). |
| **Living Records** | A batch record's life is tied to the medicine. Every scan performs a **Lifetime Extension** (+30 days on the record's current deadline, `permissionlessExtension`); if nobody vouches, the record expires on its own. |
| **Recall Forever** | Recalls are `readonly` (write-once, un-editable) and **anyone** can renew them — the issuer can't quietly take a warning down. |
| **Expiry Radar** | A true `u64` range query: everything expiring within N days, straight off the chain. |
| **Live feed** | `watchEntityEvents` over WebSocket, no `fromBlock` — you watch your own clicks land on-chain in real time. |

## How to run it (5 minutes)

```bash
npm install
npm run wallets:new        # generates 6 throwaway testnet signers into .env.local (git-ignored)

# Recommended: an Arkiv access key raises the shared RPC's query budget
# (the anonymous budget can run out under load — friction #15). Get one at
# https://hub.arkiv.network/api-keys (select Tiramisu), then set BOTH
# ARKIV_ACCESS_KEY and NEXT_PUBLIC_ARKIV_ACCESS_KEY in .env.local.

# fund them (any of these):
#   a) paste your funded wallet key into .env.local as FUNDER_PRIVATE_KEY, then:
#      npm run wallets:fund
#   b) claim testnet GLM at https://hub.arkiv.network/faucet and send manually
#      to the 6 addresses printed by wallets:new

npm run seed               # writes the synthetic demo world to Tiramisu
npm run dev                # http://localhost:3000 (hot reload)

# runtime mode (what judges hit on the Vercel deploy — also the snappiest local demo):
npm run build && npm run start   # http://localhost:3000, production build
```

No wallet? No problem — the **demo buttons on the home page sign with the
project's disposable testnet wallets**, so judges and visitors can trigger
real writes (a pharmacy scan, a public report, a counterfeit shipment) and
watch the live feed react.

The server layer treats the shared testnet RPC defensively: an optional Arkiv
access key (`ARKIV_ACCESS_KEY`) raises the RPC's anonymous query budget — the
real failure mode we hit on submission day (friction #15: when the budget is
out, the HTTP surface *hangs* while the WebSocket surface says so instantly).
On top of that, every read runs under a 6 s deadline with one retry, and hot
reads are served stale-while-revalidate from a cache that persists to disk
and ships a committed cold-start snapshot, so even budget windows degrade to
slightly-stale pages that heal as soon as reads recover. `npm run rpc:health`
probes both surfaces and prints the real error.

## Verify us without us

```bash
npm run reproduce
```

Reads the chain directly — **no keys, no servers, no frontend** — and prints
what the demo world actually contains using the same verification rules as the
UI. If the site and the chain disagree, the site is wrong.

## Repo layout

```
app/                Next.js App Router pages + API routes (server-signing demo writes)
components/         UI (search, live feed, demo panel, batch actions)
lib/arkiv-server.ts Reads (public client) + demo writes (role signers) — the verification engine
lib/{types,feed,constants}.ts
scripts/            wallets.mjs · fund.mjs · seed.mjs · reproduce.mjs · vercel-env.mjs
arkiv/schema.md     Entity design: attributes, expiries, flags, queries, what stays off Arkiv
arkiv/friction.md   Honest expected-vs-actual log from building on Arkiv (15 items, with versions and repro steps)
```

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind 4 ·
`@arkiv-network/sdk` 0.8.x · viem · Tiramisu testnet (chain ID `7738577`).

## Data & privacy

100% **synthetic demo data**. No real brand, licence, pharmacy or person is
represented. Public-scan entities record **city only** — never a person,
device or order. Private keys live only in git-ignored `.env.local` (or the
deployment's env vars) and are throwaway testnet keys.

## License

MIT — see [LICENSE](LICENSE).
