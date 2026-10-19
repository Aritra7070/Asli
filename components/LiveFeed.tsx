"use client";

import { useEffect, useState } from "react";

import { shorten, timeAgo, cn } from "@/lib/constants";
import type { FeedItem } from "@/lib/types";

const KIND_ICON: Record<string, string> = {
  batch: "💊",
  custody: "🚚",
  flag: "🚩",
  registry: "🏥",
  unknown: "•",
};

const POLL_MS = 20_000;
const WATCHDOG_MS = 10_000;
const STALE_MS = 40_000;
const ES_RETRY_MS = 60_000;

/**
 * The live feed is resilient by design, in layers:
 *
 *  1. The server streams chain events over SSE (/api/events). The browser
 *     never talks to the chain, so no key is exposed and one chain
 *     connection serves every viewer. EventSource reconnects natively.
 *  2. A watchdog: if the stream goes silent (deploy, network, serverless
 *     restart), the feed falls back to polling /api/feed and retries the
 *     stream a minute later.
 *  3. The badge reports which mode the chain connection is in — the server
 *     emits `socket` while its WebSocket subscription is up, `polling`
 *     while it is coasting on the cached feed (friction #6/#15).
 */
export default function LiveFeed({ initial }: { initial: FeedItem[] }) {
  const [items, setItems] = useState<FeedItem[]>(initial);
  const [mode, setMode] = useState<"connecting" | "socket" | "polling">(
    "connecting"
  );
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let es: EventSource | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let esRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMsgAt = Date.now();

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }

    function flash(key: string) {
      setFresh(key);
      setTimeout(() => setFresh((f) => (f === key ? null : f)), 3000);
    }

    function mergeItems(next: FeedItem[], withFlash = false) {
      if (stopped || !Array.isArray(next) || next.length === 0) return;
      setItems((prev) => {
        const seen = new Set(next.map((i) => i.entityKey));
        return [...next, ...prev.filter((p) => !seen.has(p.entityKey))].slice(
          0,
          14
        );
      });
      if (withFlash) flash(next[0].entityKey);
    }

    async function pollOnce() {
      try {
        const res = await fetch("/api/feed", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { items?: FeedItem[] };
        if (body.items) mergeItems(body.items);
      } catch {
        // offline or server starting up — keep the last known list
      }
    }

    function startPolling() {
      setMode("polling");
      void pollOnce();
      if (!pollTimer) pollTimer = setInterval(() => void pollOnce(), POLL_MS);
    }

    function connect() {
      if (stopped) return;
      try {
        es = new EventSource("/api/events");

        const alive = () => {
          lastMsgAt = Date.now();
        };

        es.addEventListener("mode", (ev) => {
          alive();
          try {
            const m = (JSON.parse((ev as MessageEvent).data) as { mode?: string })
              .mode;
            if (m === "socket" || m === "polling" || m === "connecting") {
              stopPolling();
              setMode(m);
            }
          } catch {
            // ignore malformed frame
          }
        });

        es.addEventListener("snapshot", (ev) => {
          alive();
          try {
            const next = (
              JSON.parse((ev as MessageEvent).data) as { items?: FeedItem[] }
            ).items;
            if (next) mergeItems(next);
          } catch {
            // ignore malformed frame
          }
        });

        es.addEventListener("item", (ev) => {
          alive();
          try {
            const item = JSON.parse((ev as MessageEvent).data) as FeedItem;
            if (item?.entityKey) mergeItems([item], true);
          } catch {
            // ignore malformed frame
          }
        });

        es.addEventListener("ping", alive);
      } catch {
        startPolling();
      }
    }

    connect();

    watchdog = setInterval(() => {
      if (stopped) return;
      if (Date.now() - lastMsgAt > STALE_MS) {
        es?.close();
        es = undefined;
        startPolling();
        if (!esRetryTimer) {
          esRetryTimer = setTimeout(() => {
            esRetryTimer = undefined;
            stopPolling();
            lastMsgAt = Date.now();
            connect();
          }, ES_RETRY_MS);
        }
      }
    }, WATCHDOG_MS);

    return () => {
      stopped = true;
      es?.close();
      if (esRetryTimer) clearTimeout(esRetryTimer);
      stopPolling();
      if (watchdog) clearInterval(watchdog);
    };
  }, []);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <span className="text-sm font-medium">Chain activity</span>
        <span
          className={cn(
            "mono text-[11px]",
            mode === "socket" ? "text-emerald-400" : "text-amber-400"
          )}
        >
          ● {mode === "socket" ? "live · websocket" : mode === "polling" ? "live · polling" : "connecting…"}
        </span>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {items.length === 0 && (
          <li className="px-4 py-6 text-sm text-[var(--muted)]">
            No entities yet — run{" "}
            <code className="mono text-emerald-400">npm run seed</code>.
          </li>
        )}
        {items.map((it) => (
          <li
            key={it.entityKey}
            className={cn(
              "flex items-start gap-3 px-4 py-2.5 text-sm transition-colors duration-700",
              fresh === it.entityKey && "bg-emerald-500/10"
            )}
          >
            <span className="mt-0.5 text-base leading-none">
              {KIND_ICON[it.kind] ?? "•"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{it.title}</span>
              <span className="block truncate text-xs text-[var(--muted)]">
                {it.sub} · <span className="mono">{shorten(it.creator)}</span>
              </span>
            </span>
            <span
              className="mono shrink-0 pt-0.5 text-[11px] text-[var(--muted)]"
              suppressHydrationWarning
            >
              {timeAgo(it.atMs)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
