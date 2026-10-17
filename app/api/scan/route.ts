import { NextResponse } from "next/server";
import { addCustodyScan, hasWallet, type Role } from "@/lib/arkiv-server";

export const dynamic = "force-dynamic";

const PRESETS: Record<string, { city: string; actor: string; note: string }> = {
  reliant: {
    city: "Pune",
    actor: "pharmacy",
    note: "Pharmacy intake scan — batch matched to the manufacturer attestation.",
  },
  qm: {
    city: "Gurugram",
    actor: "pharmacy",
    note: "Dark-store shelf scan during picking.",
  },
  relay: {
    city: "Pune",
    actor: "public",
    note: "Customer verified authenticity by scanning the strip. No personal data recorded.",
  },
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const batchCode = String(body.batch_code ?? "").trim().toUpperCase();
    const as = String(body.as ?? "relay");

    if (!batchCode || batchCode.length > 64) {
      return NextResponse.json(
        { ok: false, error: "batch_code is required" },
        { status: 400 }
      );
    }
    if (!(as in PRESETS)) {
      return NextResponse.json(
        { ok: false, error: `as must be one of: ${Object.keys(PRESETS).join(", ")}` },
        { status: 400 }
      );
    }
    if (!hasWallet(as as Role)) {
      return NextResponse.json(
        { ok: false, error: "Demo signers not configured on this deployment." },
        { status: 503 }
      );
    }

    const preset = PRESETS[as];
    const city =
      typeof body.city === "string" && body.city.trim()
        ? body.city.trim().slice(0, 32)
        : preset.city;

    const result = await addCustodyScan({
      role: as as Role,
      batchCode,
      city,
      actorKind: preset.actor,
      note: preset.note,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
