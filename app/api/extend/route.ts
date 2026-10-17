import { NextResponse } from "next/server";
import { extendByKey, hasWallet } from "@/lib/arkiv-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const entityKey = String(body.entity_key ?? "").trim();
    // `days` is how much life to ADD to the flag's current deadline (not a new
    // lifetime from now) — an extension can never shorten, see lib/arkiv-server.
    const days = Math.max(1, Math.min(1095, Number(body.days) || 30));

    if (!/^0x[0-9a-fA-F]{64}$/.test(entityKey)) {
      return NextResponse.json(
        { ok: false, error: "entity_key must be a 32-byte hex entity key" },
        { status: 400 }
      );
    }
    // Deliberately extended by the *relay* wallet, not the owner: flags are
    // created with permissionlessExtension, so any wallet can keep them alive.
    if (!hasWallet("relay")) {
      return NextResponse.json(
        { ok: false, error: "Demo signers not configured on this deployment." },
        { status: 503 }
      );
    }

    const result = await extendByKey("relay", entityKey, days);
    return NextResponse.json({
      ok: true,
      txHash: result.txHash,
      expiresAt: result.expiresAt.toString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
