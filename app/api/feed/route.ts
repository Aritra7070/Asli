import { NextResponse } from "next/server";
import { getLatestFeed } from "@/lib/arkiv-server";

export const dynamic = "force-dynamic";

/**
 * Feed polling fallback for the browser. The live feed prefers a WebSocket
 * subscription, but when the socket surface is unavailable (shared testnet
 * read budget exhausted, flaky connection) the client polls this endpoint.
 * Reads ride the same stale-while-revalidate cache as the rest of the app,
 * so polling during an outage still serves the last good copy, and recovers
 * on its own when the network comes back.
 */
export async function GET() {
  try {
    const items = await getLatestFeed(10);
    const body = JSON.stringify({ ok: true, items }, (_k, v) =>
      typeof v === "bigint" ? Number(v) : v
    );
    return new NextResponse(body, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
