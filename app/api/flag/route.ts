import { NextResponse } from "next/server";
import { createFlag, hasWallet, type Role } from "@/lib/arkiv-server";

export const dynamic = "force-dynamic";

const KINDS = new Set(["recall", "counterfeit_report", "expiry_report"]);
const ALLOWED_ROLES: Role[] = ["relay", "mfr"];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const batchCode = String(body.batch_code ?? "").trim().toUpperCase();
    const kind = String(body.kind ?? "counterfeit_report");
    const severity = Math.max(1, Math.min(5, Number(body.severity) || 2));
    const title = String(body.title ?? "Suspicious batch reported").slice(0, 120);
    const detail = String(
      body.detail ??
        "Reported via Asli. A flag is write-once and cannot be edited or taken down."
    ).slice(0, 500);
    const city = typeof body.city === "string" ? body.city.slice(0, 32) : undefined;
    const as = String(body.as ?? "relay") as Role;

    if (!batchCode || batchCode.length > 64) {
      return NextResponse.json(
        { ok: false, error: "batch_code is required" },
        { status: 400 }
      );
    }
    if (!KINDS.has(kind)) {
      return NextResponse.json(
        { ok: false, error: "kind must be recall, counterfeit_report or expiry_report" },
        { status: 400 }
      );
    }
    if (!ALLOWED_ROLES.includes(as)) {
      return NextResponse.json(
        { ok: false, error: "as must be relay or mfr" },
        { status: 400 }
      );
    }
    if (!hasWallet(as)) {
      return NextResponse.json(
        { ok: false, error: "Demo signers not configured on this deployment." },
        { status: 503 }
      );
    }

    const result = await createFlag({
      role: as,
      batchCode,
      kind: kind as "recall" | "counterfeit_report" | "expiry_report",
      severity,
      title,
      detail,
      city,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
