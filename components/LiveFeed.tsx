"use client";

import { useEffect, useState } from "react";
import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket } from "viem";

import { RPC_URL, WS_URL, shorten, timeAgo, cn } from "@/lib/constants";
import { entityToFeedItem } from "@/lib/feed";
import type { FeedItem } from "@/lib/types";

const KIND_ICON: Record<string, string> = {
  batch: "💊",
  custody: "🚚",
  flag: "🚩",
  registry: "🏥",
  unknown: "•",
};

export default function LiveFeed({ initial }: { initial: FeedItem[] }) {
  const [items, setItems] = useState<FeedItem[]>(initial);
  const [mode, setMode] = useState<"connecting" | "socket" | "polling">(
    "connecting"
  );
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    const httpClient = createPublicClient({
      chain: tiramisu,
      transport: http(RPC_URL),
    });

    async function handleEvent(entityKey: string) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e: any = await httpClient.getEntity(entityKey as `0x${string}`);
        const head = await httpClient.getBlockNumber();
        const item = entityToFeedItem(e, head);
        if (!item) return; // not an Asli entity
        setItems((prev) =>
          [item, ...prev.filter((p) => p.entityKey !== item.entityKey)].slice(
            0,
            14
          )
        );
        setFresh(item.entityKey);
        setTimeout(
          () => setFresh((f) => (f === item.entityKey ? null : f)),
          3000
        );
      } catch {
        // entity expired between the event and the read — ignore
      }
    }

    let unwatch: (() => void) | undefined;
    try {
      // A WebSocket transport with no fromBlock gives a true live stream
      // (over plain HTTP the watcher would silently fall back to polling).
      const wsClient = createPublicClient({
        chain: tiramisu,
        transport: webSocket(WS_URL),
      });
      unwatch = wsClient.watchEntityEvents({
        onEntityCreated: (ev) => void handleEvent(ev.entityKey),
        onEntityPatched: (ev) => void handleEvent(ev.entityKey),
        onExpiryExtended: (ev) => void handleEvent(ev.entityKey),
        onError: () => setMode("polling"),
      });
      setMode("socket");
    } catch {
      setMode("polling");
    }

    return () => {
      unwatch?.();
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
