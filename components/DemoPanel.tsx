"use client";

import { useState } from "react";
import { DEMO } from "@/lib/constants";

type Action = {
  key: string;
  label: string;
  hint: string;
  body: Record<string, unknown>;
  url: string;
  tone: "ok" | "warn" | "danger";
};

const ACTIONS: Action[] = [
  {
    key: "pharma",
    label: "📷 Pharmacy intake scan",
    hint: "Reliant Pharmacy (registered wallet) logs a scan and extends the record's life",
    url: "/api/scan",
    body: { batch_code: DEMO.heroCode, as: "reliant" },
    tone: "ok",
  },
  {
    key: "public",
    label: "🧍 Public scan — Pune",
    hint: "An anonymous patient scan, signed by the Asli relay. City-level only, no personal data",
    url: "/api/scan",
    body: { batch_code: DEMO.heroCode, as: "relay", city: "Pune" },
    tone: "ok",
  },
  {
    key: "fake",
    label: "⚠️ Counterfeit shipment — unregistered signer",
    hint: "A Telegram-style seller stamps the same batch code from an unregistered wallet",
    url: "/api/counterfeit",
    body: {},
    tone: "danger",
  },
  {
    key: "report",
    label: "🚩 Public report — lookalike units",
    hint: "A citizen report against the batch, written once and never editable",
    url: "/api/flag",
    body: {
      batch_code: DEMO.heroCode,
      kind: "counterfeit_report",
      severity: 2,
      title: "Lookalike units at an unregistered seller",
      detail:
        "Boxes for this batch code seen 50% below MRP on an online channel. Demo report.",
      city: "Delhi",
    },
    tone: "warn",
  },
  {
    key: "qc",
    label: "🛵 Quick-commerce scan — Gurugram",
    hint: "Dark-store scan on the near-expiry Feverex batch",
    url: "/api/scan",
    body: { batch_code: DEMO.quickCode, as: "qm" },
    tone: "ok",
  },
];

export default function DemoPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string>("Pick an action — each one is a real signed transaction on Arkiv Tiramisu.");

  async function run(a: Action) {
    setBusy(a.key);
    setResult(`Writing "${a.label}"… (signing + mining — usually a few seconds)`);
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(a.body),
      });
      const data = await res.json();
      if (data.ok) {
        const tx = (data.txHash ?? "").slice(0, 14);
        const ent = (data.entityKey ?? data.entityKeys?.[0] ?? "").slice(0, 14);
        setResult(`✅ Done. tx ${tx}… · entity ${ent}… — watch the feed light up.`);
      } else {
        setResult(`❌ ${data.error ?? "Write failed"}`);
      }
    } catch (e) {
      setResult(`❌ ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-1 text-sm font-medium">Live demo — no wallet needed</div>
      <p className="mb-4 text-xs text-[var(--muted)]">
        These buttons sign with the project&apos;s disposable testnet wallets, so
        you can write to the chain exactly like a real pharmacy would.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => run(a)}
            disabled={busy !== null}
            title={a.hint}
            className={`rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:opacity-40 ${
              a.tone === "danger"
                ? "border-red-500/40 hover:bg-red-500/10"
                : a.tone === "warn"
                  ? "border-amber-500/40 hover:bg-amber-500/10"
                  : "border-emerald-500/30 hover:bg-emerald-500/10"
            }`}
          >
            <span className="block">{busy === a.key ? "⏳ " : ""}{a.label}</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">{a.hint}</span>
          </button>
        ))}
      </div>
      <div className="mono mt-3 min-h-[2.5rem] rounded-lg bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--muted)]">
        {result}
      </div>
    </div>
  );
}
