// Server-side live event hub: one chain connection per server instance,
// many browsers.
//
// The browser-facing transport is Server-Sent Events (see app/api/events).
// Consequences, all deliberate:
//   * the access key never leaves the server — the browser no longer talks
//     to the chain at all (closes the exposure tradeoff in friction #15),
//   * N viewers cost N HTTP streams, not N chain WebSockets — quota usage no
//     longer multiplies with traffic,
//   * EventSource reconnects on its own, and a ring buffer replays the items
//     a client missed while it was away.
//
// The chain side prefers a true WebSocket subscription (no `fromBlock`) and
// falls back to polling the cached feed while the socket is unavailable
// (shared testnet read budget — friction #15/#16). Reconnection backs off
// exponentially and everything stops when nobody is subscribed.

import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket } from "viem";

import { RPC_URL, WS_URL } from "@/lib/constants";
import { entityToFeedItem } from "@/lib/feed";
import { getLatestFeed } from "@/lib/arkiv-server";
import type { FeedItem } from "@/lib/types";

export type LiveMode = "connecting" | "socket" | "polling";

type LiveEvent =
  | { type: "item"; item: FeedItem }
  | { type: "mode"; mode: LiveMode }
  | { type: "snapshot" };

const RING_MAX = 20;
const SNAPSHOT_SIZE = 14;
const POLL_MS = 25_000;
const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 60_000;

const ring: FeedItem[] = [];
const subscribers = new Set<(ev: LiveEvent) => void>();

let mode: LiveMode = "connecting";
let running = false;
let unwatch: (() => void) | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let backoffStep = 0;
let socketSeq = 0;

function accessKey(): string {
  return (
    process.env.ARKIV_ACCESS_KEY ??
    process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ??
    ""
  );
}

function withKey(url: string): string {
  const key = accessKey();
  if (!key) return url;
  return `${url.replace(/\/+$/, "")}/${encodeURIComponent(key)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let httpClient: any;
function readClient() {
  if (!httpClient) {
    httpClient = createPublicClient({
      chain: tiramisu,
      transport: http(
        RPC_URL,
        accessKey()
          ? { fetchOptions: { headers: { "X-API-KEY": accessKey() } } }
          : {}
      ),
    });
  }
  return httpClient;
}

function broadcast(ev: LiveEvent) {
  for (const fn of subscribers) {
    try {
      fn(ev);
    } catch {
      // a dead stream unsubscribes itself on cancel
    }
  }
}

function setMode(next: LiveMode) {
  if (mode === next) return;
  mode = next;
  broadcast({ type: "mode", mode });
}

function pushItem(item: FeedItem, announce = true) {
  const i = ring.findIndex((r) => r.entityKey === item.entityKey);
  if (i >= 0) ring.splice(i, 1);
  ring.unshift(item);
  if (ring.length > RING_MAX) ring.length = RING_MAX;
  if (announce) broadcast({ type: "item", item });
}

async function handleEvent(entityKey: string) {
  try {
    const e = await readClient().getEntity(entityKey as `0x${string}`);
    const head = await readClient().getBlockNumber();
    const item = entityToFeedItem(e, head);
    if (item) pushItem(item);
  } catch {
    // entity expired between event and read, or a budget window — the
    // poller below re-syncs the list
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function pollDiff() {
  try {
    const latest = await getLatestFeed(10);
    for (let i = latest.length - 1; i >= 0; i--) {
      const it = latest[i];
      if (!ring.some((r) => r.entityKey === it.entityKey)) pushItem(it);
    }
  } catch {
    // cache serves the last good copy — nothing to do
  }
}

function startPolling() {
  setMode("polling");
  void pollDiff();
  if (!pollTimer) pollTimer = setInterval(() => void pollDiff(), POLL_MS);
}

function scheduleRetry() {
  if (!running || retryTimer) return;
  unwatch?.();
  unwatch = undefined;
  startPolling();
  const delay = Math.min(RETRY_BASE_MS * 2 ** backoffStep, RETRY_MAX_MS);
  backoffStep = Math.min(backoffStep + 1, 10);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    startWatcher();
  }, delay);
}

function startWatcher() {
  if (!running) return;
  try {
    // A fresh socket cache key per attempt: a failed socket client must
    // never be reused, or retries would attach to a dead socket.
    const seq = ++socketSeq;
    const wsClient = createPublicClient({
      chain: tiramisu,
      transport: webSocket(withKey(WS_URL), {
        key: `asli-hub-${seq}`,
        reconnect: false, // we own reconnects — viem's built-in retry logs raw error events
      }),
    });
    unwatch = wsClient.watchEntityEvents({
      onEntityCreated: (ev) => void handleEvent(ev.entityKey),
      onEntityPatched: (ev) => void handleEvent(ev.entityKey),
      onExpiryExtended: (ev) => void handleEvent(ev.entityKey),
      onError: () => scheduleRetry(),
    });
    backoffStep = 0;
    stopPolling();
    setMode("socket");
  } catch {
    scheduleRetry();
  }
}

export function ensureLiveStarted() {
  if (running) return;
  running = true;
  backoffStep = 0;
  // Prime the ring from the cached feed. Silent for the individual items
  // (backfill must not flash as fresh activity); once it lands, subscribers
  // get one `snapshot` event to merge.
  void getLatestFeed(10)
    .then((items) => {
      for (let i = items.length - 1; i >= 0; i--) pushItem(items[i], false);
      broadcast({ type: "snapshot" });
    })
    .catch(() => {});
  startWatcher();
}

function stopLive() {
  running = false;
  unwatch?.();
  unwatch = undefined;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  stopPolling();
  setMode("connecting");
}

export function subscribeLive(fn: (ev: LiveEvent) => void): () => void {
  ensureLiveStarted();
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) stopLive();
  };
}

export function liveSnapshot(): FeedItem[] {
  return ring.slice(0, SNAPSHOT_SIZE);
}

export function liveMode(): LiveMode {
  return mode;
}
