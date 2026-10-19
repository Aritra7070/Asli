# Friction log — building Asli on Arkiv Tiramisu

Real, dated friction encountered while building, expected-vs-actual where we
had an expectation, and what we did about it. Written during the build, not
after. (Judges: this is the honest version — including the parts we fixed and
the parts we lived with.)

## Environment

- `@arkiv-network/sdk` **0.8.1** · `viem` **2.57.7** · Node **24.4.1** ·
  Next.js **15.5.28**
- Arkiv **Tiramisu** testnet (chain id `7738577`), RPC
  `https://rpc.tiramisu.db-chain.testnet.arkiv.network` (public, rate-limited)
- Built **9–18 October 2026**; each item below was hit while building this app —
  the commits in this repo show the fixes where we applied one.

## 1. No server-side ordering

- **Expected:** a way to order query results (e.g. an `orderBy`) or at least
  filter on creation time.
- **Actual:** results come back **newest-first only**; there is no `orderBy`,
  and among the system attributes only `$expiresAt` carries an index —
  `$createdAt`/`$updatedAt` are not filterable.
- **Workaround:** fetch the working set and sort in application code. Custody
  trails sort by our own `at_ms` `u64` attribute. The activity feed merges one
  query per entity type and sorts by block number client-side.

## 2. Predicate types must match stored types exactly — and mismatch is silent

- **Expected:** a type-mismatched query would error, or coerce.
- **Actual:** `eq("severity", str("2"))` against an `i32` attribute returns an
  **empty result set with no error** (documented as "a type mismatch is not an
  error: the query runs and returns nothing").
- **Workaround:** every value is built through its constructor (`str()`, `u64()`,
  `i32()`) on both the write and the query side, in one shared file, so the two
  sides cannot drift. This is the single most important discipline in the
  codebase.

## 3. Hex-typed entity keys

- **Expected:** entity keys are strings.
- **Actual:** the SDK types them as `` `0x${string}` `` (Hex). Passing a
  runtime `string` (e.g. an entity key echoed back over HTTP earlier) fails
  the type-checker, not at runtime.
- **Workaround:** cast at the API boundary (`entityKey as `0x${string}``) after
  validating the shape with a regex. Noted because it is the kind of thing
  that shows up in a compiler error that looks scarier than it is.

## 4. u64 values arrive as bigints

- **Expected:** `Date.now()` goes in, a number comes out.
- **Actual:** `u64` attribute values deserialize as `bigint`. Easy to catch in
  TypeScript, easy to miss in ad-hoc scripts.
- **Workaround:** every read path funnels through one `attrNum()` helper that
  converts `u64`/`u256` bigints to numbers safely inside the ms-timestamp range.

## 5. Durations are quantized to 2-second blocks

- **Expected:** `fromSeconds(7)` gives 7 seconds.
- **Actual:** lifetimes are whole blocks at a nominal 2s each; an odd number of
  seconds is rejected.
- **Workaround:** only `fromDays`/`fromYears` are used in the app; noted so the
  next person doesn't debug a mysteriously rejected write.

## 6. "Live" events over HTTP are not live

- **Expected:** `watchEntityEvents` with no `fromBlock` streams events as they
  land.
- **Actual:** over an HTTP transport the watcher **silently polls**. To get a
  true realtime stream the client must use a **WebSocket transport** and omit
  `fromBlock`.
- **Workaround:** the browser feed creates a second public client over
  `webSocket(WS_URL)`. The feed badge shows `live · websocket` vs
  `live · polling` so users can see which mode they are actually in. (Silent
  degradation is the dangerous part — the UI now says it out loud.)

## 7. No OR across different attributes in one query

- **Expected:** one query for "the newest entities of any type" for the feed.
- **Actual:** the query language filters on attribute *pairs*; there is no way
  to express "type = batch OR type = custody OR type = flag" (each entity only
  carries one of these values — a compound `and` on the same attribute matches
  nothing, which we initially wrote by mistake and caught in review).
- **Workaround:** one query per entity type, merged and sorted in code. Three
  cheap queries beat one impossible one.

## 8. Nonce collisions on concurrent writes from one wallet

- **Expected:** fire-and-forget parallel writes from a demo signer.
- **Actual:** two writes in flight from the same wallet fetch the same nonce;
  one is rejected or replaces the other.
- **Workaround:** documented fix applied — `executeBatch` wherever multiple
  writes belong together (a scan writes its custody entity **and** its Lifetime
  Extension in one atomic transaction; the counterfeit shipment is one batch of
  two creates), plus viem's `nonceManager` on server-side accounts. Residual
  risk if the same signer is used from two server instances at once; fine for a
  demo, worth a dedicated relay service in production.

## 9. Public RPC is heavily rate-limited

- **Expected:** the public Tiramisu RPC would serve a hackathon demo.
- **Actual:** it does — until the **shared anonymous query budget runs out**
  under load. Then the HTTP surface hangs silently while the WebSocket
  surface returns `unauthenticated query budget exhausted` (see #15 for the
  full hunt; we misread it as "the RPC stalls sometimes" for most of build
  day).
- **Workaround:** the app now supports an Arkiv access key
  (`ARKIV_ACCESS_KEY`, sent as an `X-API-KEY` header server-side;
  `NEXT_PUBLIC_ARKIV_ACCESS_KEY`, in the URL path for the browser live feed)
  — one key per wallet per network, free. Lesson: don't wait to hit the
  budget; create a key *before* demo day.

## 10. Funding six signers for a no-wallet demo

- **Expected:** one faucet claim would cover the demo.
- **Actual:** the faucet funds the *connected wallet* only, one claim per wallet
  per cooldown window; our architecture (judges click buttons, the server signs)
  needs several signers so the custody trail has plural `$creator`s.
- **Workaround:** a generator script creates six throwaway signers into a
  git-ignored `.env.local`, and a separate funding script distributes GLM from
  whatever funded wallet the builder chooses. Wallets and keys never touch the
  repository.

## 11. Deciding the join key

- **Expected:** `key` attributes would link custody hops to batch entities.
- **Actual:** `key` is a *weak* reference — nothing checks that the target
  exists, references to expired entities dangle, **and** predicting the key of
  an entity created in the same batch requires `predictEntityKeys` + explicit
  salts, which spreads complexity across every write.
- **Decision:** join on `batch_code` (a `str` attribute) instead. It is the
  identifier a human reads off the box; it keeps every write simple; and it is
  the only link that survives a counterfeiter cloning the label — which is
  precisely the scenario the product exists for.

## 12. Exact expiry dates can be "dead on arrival"

- **Expected:** `atDate(printedExpiry)` ties a record to the medicine.
- **Actual:** an absolute block that resolves too close to the current head is
  rejected outright; and a near expiry leaves the record with less life than
  intended.
- **Workaround:** the documented pattern — `atDate(date, { atLeast: fromDays(N) })`
  puts a floor under the deadline. The demo batches use a 150-day floor so
  early judges see them, while the story ("the record lives with the medicine")
  stays intact.

---

## 13. Arkiv is shared space — namespace or collide (observed live)

- **Expected:** our `type` attribute values were ours alone.
- **Actual:** during a read smoke-test we found **three `type = "registry"`
  entities in the live data that belong to another team's project** matching
  our query — they lack every other attribute we expect, and printing them
  produced rows of `undefined`. On a shared testnet, plain string attribute
  values are a public namespace.
- **Fix applied:** every entity we write uses a namespaced type value
  (`asli.batch`, `asli.custody`, `asli.flag`, `asli.registry`), and every query
  ANDs on it. The live-event watcher additionally drops any event whose entity
  does not carry an `asli.*` type — otherwise every other team's writes would
  appear in our activity feed.

---

## 14. "Renew for 150 days" can be a *shortening* — hit live, fixed the same hour

- **Expected:** every custody hop writes its entity and renews the batch record
  in one atomic `executeBatch` — the renewal reading naturally as
  `ExpirationTime.fromDays(150)` ("keep it alive for 150 more days").
- **Actual:** the first seeded hop reverted on-chain:
  `ExpiryNotExtended(…, newExpiresAt 7190262, currentExpiresAt 11731916)` —
  *"entity 0x1d28020d… already expires at block 11731916, so extending it to
  7190262 would shorten its life"*. The batch was **created** with
  `atDate(printedExpiry, …)` — a date pinned to the medicine's real expiry
  (~255 days out) — while the renewal's duration resolves **from now**
  (150 days). Extensions **set an absolute deadline**; they do not add to what
  the record has left.
- **Fix applied:** the rule everywhere in the codebase is now *"renewal =
  current expiry + N days"*: read the entity's deadline from the chain, then
  `ExpirationTime.atBlock(current + blocks(N))`. That cannot shorten by
  construction, whatever a create pinned. We also asked the chain for its real
  timing (`arkiv_getBlockTiming`): Tiramisu runs at **exactly 2s blocks**,
  matching the SDK's nominal conversion, so the date↔block math here is exact.
- **Takeaway:** "from-now" durations and "absolute-date" creates don't compose
  arithmetically; the mental model "`fromDays(N)` always lengthens" is wrong
  when creates pin dates. The engine refusing the shortening (instead of
  silently truncating a record's life) is a feature worth keeping.

---

## 15. "RPC stalls" were the anonymous query budget running out — and HTTP hides it

- **Expected:** the same `select()` that answered in ~300 ms two minutes
  earlier keeps working; if the node is overloaded (or we're over quota) it
  fails fast with an error we can show.
- **Actual (the long version):** on submission day the query surface entered
  windows where single `arkiv_query` calls **never returned at all** — one
  probe sat pending for **300 s**; a page render logged `GET / 200 in
  180014ms`. `eth_blockNumber` on the *same endpoint* stayed under 1 s, and
  the windows "passed by themselves" (minutes later, 24 back-to-back queries
  answered in 300–900 ms). So we spent build day treating it as transient
  overload.
- **Root cause, found late and by accident:** a probe against the **WebSocket**
  endpoint returned the real story in 1.9 s — `unauthenticated query budget
  exhausted; get an API key at https://hub.arkiv.network for a monthly quota`.
  The "stalls" were the **shared anonymous budget being exhausted** (peak
  submission-day traffic — our own refresh traffic included). Cruelly, the
  **HTTP gateway hangs** on a depleted budget while the **WebSocket returns
  the error immediately**: same key, opposite failure modes.
- **Why it burned us:** viem's transport `timeout`/`retryCount` did not reject
  the hung calls, and the SDK exposes no deadline knob — so in a server
  framework one hung read *is* a hung page, indistinguishable from "the site
  is broken". (Our Radar page showed its "unavailable" card while the data
  was fine on-chain.)
- **Fix shipped (in this repo):**
  1. **Access-key support.** `ARKIV_ACCESS_KEY` is sent server-side as an
     `X-API-KEY` header; `NEXT_PUBLIC_ARKIV_ACCESS_KEY` went in the URL path
     for the browser's live-feed WebSocket (browser WebSockets cannot set
     headers) — since retired, see item 4. This is the actual cure, not a
     workaround.
  2. **A 6 s read deadline + one retry** per chain read, so a hung request
     fails fast instead of freezing a render.
  3. **Stale-while-revalidate cache** for the hot reads (`counts`, `feed`,
     `batch:<code>`, `radar`, `registries`) — persisted to disk
     (`.cache/reads.json`) with a committed cold-start snapshot
     (`arkiv/cache-snapshot.json`); writes mark cached reads stale instead of
     clearing them; a self-healing warmer refetches the demo pages on a timer
     (cadence later slowed 45 s → 30 min with backoff — see #16).
  4. **Server-side live stream** (added later, after #16). The browser no
     longer talks to the chain at all: a server-side hub (`lib/live-hub.ts`)
     holds **one** WebSocket subscription per instance and streams events to
     every viewer over SSE (`/api/events`), with a ring buffer that replays
     what a client missed while reconnecting. The exposed browser key from
     item 1 is retired, and quota usage no longer scales with viewer count.
  Diagnostics in-repo: `npm run rpc:health` — it probes **both** surfaces and
  prints the real error. That probe is how this was finally found.
- **Ask:**
  1. Make the HTTP gateway surface the rate-limit error the way WebSocket
     does — hanging on a depleted budget is the worst of both worlds.
  2. Document that the anonymous budget is shared and can vanish for hours;
     put "get an access key before your demo" where people will see it.
  3. Publish a server-side maximum runtime for `arkiv_query` (or a
     `timeoutMs` request option) so clients can pick deadlines instead of
     guessing.

---

## 16. The access key's monthly query budget can be silently drained — by your own warm-up loop

- **Expected:** an access key ends the quota problem; a demo site with a
  self-healing cache warmer should not burn a month's budget in a weekend.
- **Actual:** the key carries a **monthly** query budget, and our first
  warmer design — refetching every demo page every **45 s** (~18 queries per
  cycle, ≈1,400/hour, ≈35k/day) — drained it in about two days. Queries then
  failed with `429 QUOTA_EXCEEDED` on `arkiv_query`, while `eth_blockNumber`
  on the same endpoint kept answering in under a second — so "node down" and
  "query budget gone" look nearly identical from inside a health check.
- **Why it burned us:** the deployed demo silently fell back to the
  committed cold-start snapshot: cached pages (home, radar, the three demo
  batches) kept rendering, but any uncached batch code dead-ended on a raw
  error card. A reviewer typing an arbitrary code would see a broken site
  while the demo itself was fine — the exact opposite of what the cache was
  built to achieve.
- **Fix shipped (in this repo):**
  a. **Warmer cadence 45 s → 30 min, with a probe:** each cycle first issues
     one cheap query; if it fails the cycle is skipped and the next backs
     off exponentially (30 min → 2 h cap), so a dead budget is never
     hammered.
  b. **Longer stale-while-revalidate TTLs** (batch 5 min, radar 10 min,
     counts 5 min, feed 2 min). Reads stay interactive because writes bust
     the cache — a judge's own scan still shows up immediately.
  c. **The error card now routes reviewers to the cached demo batches**
     instead of dead-ending, and says the testnet read budget is shared.
  d. `npm run reproduce` uses an optional key and, on a quota failure,
     prints exactly how to get one — a reviewer hitting an empty anonymous
     budget gets instructions, not a stack trace.
- **Ask:** surface the remaining quota in the hub (and in the 429 body):
  "quota resets in N days / N queries left" turns budgeting from guesswork
  into arithmetic, and a per-key usage chart would make poll intervals a
  design decision instead of a surprise.

---

_Running total: 16 items. Friction is data — this file is updated as we hit
more, and shipped as-is._
