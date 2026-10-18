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
- **Actual:** it does, but the docs call it "heavily rate limited and meant for
  testing", and parallel page loads make it visible (slower page renders when
  many queries fire at once).
- **Workaround:** pages issue few, focused queries; entity pages query once per
  request (deduplicated between `generateMetadata` and the page via React
  `cache`). A production deployment would use an Arkiv access key server-side.

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

## 15. The testnet RPC can stall for minutes — queries hang, pages freeze

- **Expected:** the same `select()` that answered in ~300 ms two minutes
  earlier keeps working; if the node is overloaded it fails fast.
- **Actual:** on the final build day the query surface entered a window where
  single `arkiv_query` calls **never returned at all**: a probe we let run was
  still pending after **300 s**, and a page render logged
  `GET / 200 in 180014ms`. `eth_blockNumber` on the *same endpoint* stayed
  under 1 s throughout, so it was queries specifically — and the window passed
  by itself: minutes later 24 identical back-to-back queries answered in
  300–900 ms, and an 8-way parallel burst finished in 863 ms.
- **Why it burned us:** viem's transport `timeout`/`retryCount` did not reject
  the hung calls (nothing threw for minutes), and the SDK exposes no deadline
  knob. In a server framework one hung read *is* a hung page — which from the
  outside is indistinguishable from "the site is broken".
- **Workaround shipped (in this repo):** every chain read now runs under a
  12 s deadline with one retry; hot reads (`counts`, `feed`, `batch:<code>`,
  `radar`, `registries`) are served **stale-while-revalidate** from a small
  in-memory cache, so a stalled RPC degrades to slightly-stale-but-instant
  pages instead of a frozen site; successful writes bust the cache so the
  demo always shows its own effects. Diagnostic kept in-repo:
  `npm run rpc:health` (per-query latency probe).
- **Ask:** a documented server-side maximum runtime for `arkiv_query` (or a
  `timeoutMs` request option). Knowing "the node kills a query after N
  seconds" would let clients pick the right deadline instead of guessing.

---

_Running total: 15 items. Friction is data — this file is updated as we hit
more, and shipped as-is._
