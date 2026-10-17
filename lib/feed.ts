// Client-safe: turn a raw chain entity into a feed row. Shared by the
// server-rendered first page of the feed and the browser watcher.

import type { ChainEntityLike, FeedItem } from "@/lib/types";

function attr(e: ChainEntityLike, name: string) {
  return e.attributes?.[name];
}

function attrStr(e: ChainEntityLike, name: string): string | undefined {
  const a = attr(e, name);
  return a?.type === "str" ? (a.value as string) : undefined;
}

function attrNum(e: ChainEntityLike, name: string): number | undefined {
  const a = attr(e, name);
  if (!a) return undefined;
  if (a.type === "u64" || a.type === "u256") return Number(a.value as bigint);
  if (a.type === "i32") return a.value as number;
  if (a.type === "dec") return Number(a.value as string);
  return undefined;
}

function payloadJson(e: ChainEntityLike): Record<string, unknown> {
  try {
    const fn = (e as unknown as { toJson?: () => unknown }).toJson;
    const out = fn ? fn.call(e) : {};
    return typeof out === "object" && out !== null
      ? (out as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function entityToFeedItem(e: ChainEntityLike, head: bigint): FeedItem | null {
  const rawType = attrStr(e, "type") ?? "";
  // Arkiv is shared space: only surface our own namespaced entities.
  if (!rawType.startsWith("asli.")) return null;
  const t = rawType.replace(/^asli\./, "");
  const batchCode = attrStr(e, "batch_code");
  const atMs = attrNum(e, "at_ms") ?? Date.now() - Number(head - e.createdAt) * 2000;

  let title = "Activity";
  let sub = "";
  if (t === "batch") {
    title = `Batch attested — ${batchCode ?? "?"}`;
    sub = attrStr(e, "drug_name") ?? "";
  } else if (t === "custody") {
    title = `Scan — ${batchCode ?? "?"}`;
    sub = `${attrStr(e, "actor_kind") ?? "actor"} · ${attrStr(e, "city") ?? ""}`;
  } else if (t === "flag") {
    const kind = attrStr(e, "kind") ?? "flag";
    title =
      kind === "recall"
        ? `RECALL — ${batchCode ?? "?"}`
        : `Report — ${batchCode ?? "?"}`;
    const p = payloadJson(e);
    sub = typeof p.title === "string" ? p.title : "";
  } else if (t === "registry") {
    title = `Registered — ${attrStr(e, "name") ?? "?"}`;
    sub = `${attrStr(e, "role") ?? ""} · ${attrStr(e, "city") ?? ""}`;
  }

  return {
    entityKey: e.key,
    kind: t as FeedItem["kind"],
    title,
    sub,
    creator: e.creator,
    atBlock: e.createdAt,
    atMs,
  };
}
