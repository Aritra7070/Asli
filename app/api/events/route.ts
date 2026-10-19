import {
  ensureLiveStarted,
  liveMode,
  liveSnapshot,
  subscribeLive,
} from "@/lib/live-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The browser-facing live feed: Server-Sent Events.
 *
 * The server (lib/live-hub.ts) holds the chain connection; browsers just
 * read this stream. EventSource handles reconnection natively, and because
 * streams are closed gracefully before serverless platforms cut them, a
 * reconnect is a normal event — the snapshot replays anything missed.
 */
const HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
  connection: "keep-alive",
};

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

export async function GET() {
  ensureLiveStarted();

  const encoder = new TextEncoder();
  let unsub: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let cutoff: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        if (cutoff) clearTimeout(cutoff);
        unsub?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      send("retry: 2000\n\n");
      send(`event: mode\ndata: ${json({ mode: liveMode() })}\n\n`);
      send(`event: snapshot\ndata: ${json({ items: liveSnapshot() })}\n\n`);

      unsub = subscribeLive((ev) => {
        if (ev.type === "mode") {
          send(`event: mode\ndata: ${json({ mode: ev.mode })}\n\n`);
        } else if (ev.type === "snapshot") {
          send(`event: snapshot\ndata: ${json({ items: liveSnapshot() })}\n\n`);
        } else {
          send(`event: item\ndata: ${json(ev.item)}\n\n`);
        }
      });

      // A named heartbeat, not just a comment: the client uses it as a
      // liveness signal for its polling fallback.
      keepAlive = setInterval(() => send(`event: ping\ndata: {}\n\n`), 15_000);

      // Close gracefully well before serverless platforms cut long streams;
      // EventSource reconnects by itself and the snapshot replays misses.
      cutoff = setTimeout(finish, 50_000);
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      if (cutoff) clearTimeout(cutoff);
      unsub?.();
    },
  });

  return new Response(stream, { headers: HEADERS });
}
