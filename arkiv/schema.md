# Asli — Arkiv entity schema

**Network:** Arkiv Tiramisu testnet · chain ID `7738577`
**RPC:** `https://rpc.tiramisu.db-chain.testnet.arkiv.network` · **WS:** `wss://rpc.tiramisu.db-chain.testnet.arkiv.network`
**SDK:** `@arkiv-network/sdk` 0.8.x
**Data:** synthetic demo data only. No real product, licence, pharmacy or person is represented, and no personal data (plaintext or hashed) is ever written.

## Design rules we hold ourselves to

1. **Attributes are for filtering; payloads are for display.** Anything a query needs to constrain (identifiers, codes, numbers, timestamps, statuses) is a typed attribute. Free-form text, titles and notes live in the JSON payload.
2. **Numbers are stored as numbers.** Timestamps and quantities are `u64`/`i32` so range queries work. (`str` values can only be equality- or prefix-matched.)
3. **The join key is the printed batch code.** Everything about a batch — attestations, custody hops, flags — carries `batch_code` as a `str` attribute, because that is what a person reads off the strip. We deliberately do **not** use `key` references: a `key` attribute is a weak reference with no existence check, and the human-scannable code is the real-world identifier.
4. **Entity Expiration is per type.** Each entity type reasons about its own lifetime, and the "Living Records" pattern uses `permissionlessExtension` so that scans (not owners) keep records alive.
5. **Names are immutable identifiers for queries.** All attribute names are lowercase `snake_case` (the network rejects uppercase).
6. **Type values are namespaced (`asli.*`).** Arkiv is shared space: while building we found foreign `registry` entities from another project matching a naive `type = "registry"` query. Every query therefore ANDs on a namespaced type value — `asli.batch`, `asli.custody`, `asli.flag`, `asli.registry` — so another team's schema can never bleed into Asli (see friction item 13).

## Entity types

### 1. `registry` — who is allowed to vouch

| attribute | type | values / notes |
|---|---|---|
| `type` | `str` | `"asli.registry"` |
| `wallet_addr` | `addr` | the signer being registered (equals `$creator` — self-signed) |
| `name` | `str` | e.g. `Reliant Pharmacy` |
| `role` | `str` | `manufacturer` \| `distributor` \| `pharmacy` \| `relay` |
| `city` | `str` | e.g. `Pune` |
| `since_ms` | `u64` | registration timestamp |

Payload: `{ note }`. Flags: none (mutable — a registry entry may need updating). Expiry: **2 years**.

In this demo, registries are **self-signed**: voluntary but public. Production layers regulator attestations (e.g. a state FDA wallet) on the same shape; the counterfeit-contrast feature only needs *someone* to be able to say "this wallet is known" — and for the unregistered wallet to be visibly missing.

### 2. `batch` — an attestation that a batch exists

| attribute | type | values / notes |
|---|---|---|
| `type` | `str` | `"asli.batch"` |
| `batch_code` | `str` | printed code, e.g. `GF5-26A-0142` |
| `drug_code` | `str` | e.g. `GF5-PEN-5MG` |
| `drug_name` | `str` | display name (short — `str` is 128 bytes) |
| `status` | `str` | `live` (kept minimal; state changes become custody/flags) |
| `canonical` | `bool` | `true` only on the manufacturer's attestation |
| `units` | `u64` | declared batch size |
| `exp_at_ms` | `u64` | printed drug expiry (ms) — powers the Expiry Radar range query |
| `mfg_at_ms` | `u64` | manufacture date (ms) |
| `city` | `str` | attestation city |

Payload: `{ form, note }`. Flags: **`permissionlessExtension: true`** (living records — a scan by *any* supply-chain wallet extends the record).

Expiry: `ExpirationTime.atDate(printedExpiry, { atLeast: fromDays(150) })` — the record is nominally tied to the medicine's own expiry, with a floor so near-expiry demo batches survive the judging window.

**The counterfeit-contrast mechanic lives here:** two entities with the *same* `batch_code` and the *same* attributes can exist — what differs is `$creator`. One has a registry entry; the other does not. `$creator` is fixed at creation and immutable, which is exactly what a photocopied label cannot reproduce.

### 3. `custody` — a signed handover / scan

| attribute | type | values / notes |
|---|---|---|
| `type` | `str` | `"asli.custody"` |
| `batch_code` | `str` | join key |
| `hop` | `i32` | 0 = manufacture, then distributor → pharmacy → patient… |
| `city` | `str` | city-level only — **never** a person or device identifier |
| `actor_kind` | `str` | `manufacturer` \| `distributor` \| `pharmacy` \| `public` \| `seller` |
| `at_ms` | `u64` | event time (ms) |

Payload: `{ note }`. Flags: none. Expiry: **60 days** — scans are moments, not durable records; the durable trust lives in the batch entity. Public scans are signed by a relay wallet (rate-limitable in production); the trail records *that* a scan happened and *where*, at city granularity, with no personal data whatsoever.

### 4. `flag` — recalls and reports

| attribute | type | values / notes |
|---|---|---|
| `type` | `str` | `"asli.flag"` |
| `batch_code` | `str` | join key |
| `kind` | `str` | `recall` \| `counterfeit_report` \| `expiry_report` |
| `severity` | `i32` | 1–5 (`≥ 3` recall-level) |
| `at_ms` | `u64` | issuance time (ms) |
| `city` | `str` (optional) | where the issue was observed |

Payload: `{ title, detail }`. Flags: **`readonly: true` + `permissionlessExtension: true`**.

This is the "Recall Forever" primitive:

- `readonly` means **the issuer cannot edit the warning after publication** — no quiet softening;
- the owner *can* still delete — which is why `permissionlessExtension` matters: **any wallet** can extend the flag's lifetime, so a regulator, journalist, or citizen can keep the warning alive far beyond the issuer's willingness to pay for it. If the issuer deletes it, re-creation by anyone becomes trivial and visible; deletion cannot hide the history that other observers have already replicated.

Expiry: **200 days**, renewable by anyone.

## The questions the app answers

1. **"Is this batch vouched for — and by whom?"**
   `select().where(eq("batch_code", str(code)))` → attestations + flags, then resolve each `$creator` against `select().where(eq("type", str("asli.registry")))`.
2. **"What is the batch's custody trail?"**
   Same `batch_code` query, `type = "asli.custody"` entities, sorted client-side by `at_ms` (the network returns newest-first and has no `orderBy`).
3. **"What is near expiry, or recalled?"**
   Range query: `select().where(and(eq("type", str("asli.batch")), lte("exp_at_ms", u64(now + 45d))))` — numeric attributes carry an ordered index; plus `type = "asli.flag" AND kind = "recall"`.

For live updates the UI calls `watchEntityEvents` with **no `fromBlock`** over a **WebSocket transport** (over HTTP the same call silently degrades to polling).

## What stays OFF Arkiv

- Patient identity, prescriptions, phone numbers, order IDs — anything about a person, plaintext or hashed. Public scans are city-level only.
- Product photos, leaflets, large documents — the payload cap is 128 KiB; Arkiv is the trust layer, not a CDN.
- Private inventory and pricing — only the events that constitute *public trust* are written.

## Expiry policy summary

| type | expiry | renewability |
|---|---|---|
| `registry` | 2 years | owner (patch/extend) |
| `batch` | printed expiry, floor 150 days | **any wallet** (`permissionlessExtension`) — each scan/hop adds **30 days** |
| `custody` | 60 days | owner |
| `flag` | 200 days | **any wallet** — community-renewed recalls |

Every extension is a **Lifetime Extension** (`extendEntity`): it *sets* a new expiry; an equal-or-earlier expiry is rejected, so records can only live longer, never shorter.

Because a *duration* resolves **from now** while a batch create *pins an absolute date* (the printed expiry), every renewal is computed as `atBlock(currentExpiry + blocks(N))` — read the record's current deadline from the chain, then add. `N` = 30 days: **every verified interaction adds 30 days of life**. A naive `fromDays(150)` renewal against a batch pinned to 2027 resolves *earlier* than its creation and is rejected on-chain (we hit exactly this; see `friction.md` #14).
