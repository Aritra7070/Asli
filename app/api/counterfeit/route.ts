import { NextResponse } from "next/server";
import { counterfeitShipment, hasWallet } from "@/lib/arkiv-server";
import { DEMO } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const batchCode = String(body.batch_code ?? DEMO.heroCode)
      .trim()
      .toUpperCase();
    const drugCode = String(body.drug_code ?? DEMO.heroDrug);
    const drugName = String(
      body.drug_name ?? "Glucofine 5 pen (synthetic)"
    ).slice(0, 100);
    const city = String(body.city ?? "Delhi").slice(0, 32);

    if (!batchCode || batchCode.length > 64) {
      return NextResponse.json(
        { ok: false, error: "batch_code is required" },
        { status: 400 }
      );
    }
    if (!hasWallet("fake")) {
      return NextResponse.json(
        { ok: false, error: "Demo signers not configured on this deployment." },
        { status: 503 }
      );
    }

    const result = await counterfeitShipment({ batchCode, drugCode, drugName, city });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
