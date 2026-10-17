"use client";

import { useState } from "react";

export function ExtendButton({ entityKey }: { entityKey: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function extend() {
    setState("busy");
    try {
      const res = await fetch("/api/extend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_key: entityKey, days: 30 }),
      });
      const data = await res.json();
      if (data.ok) {
        setState("done");
        setMsg(`kept alive · tx ${String(data.txHash).slice(0, 12)}…`);
      } else {
        setState("error");
        setMsg(data.error ?? "failed");
      }
    } catch (e) {
      setState("error");
      setMsg(String(e));
    }
  }

  return (
    <button
      onClick={extend}
      disabled={state !== "idle"}
      className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-60"
      title="Anyone can extend this flag — it was created with permissionlessExtension"
    >
      {state === "idle" && "♻ Keep this alive (+30 days, any wallet)"}
      {state === "busy" && "⏳ Extending…"}
      {state === "done" && "✓ Extended"}
      {state === "error" && "✕ Retry"}
      {msg && <span className="mono ml-2 text-[10px] text-[var(--muted)]">{msg}</span>}
    </button>
  );
}

export function BatchActions({ code }: { code: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function act(key: string, url: string, body: Record<string, unknown>) {
    setBusy(key);
    setMsg("Signing + mining…");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg(`✓ tx ${String(data.txHash ?? "").slice(0, 14)}… — refresh or watch the feed`);
      } else {
        setMsg(`✕ ${data.error ?? "failed"}`);
      }
    } catch (e) {
      setMsg(`✕ ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMsg("✓ Link copied — forward it on WhatsApp.");
    } catch {
      setMsg("Copy failed — select the URL from the address bar.");
    }
  }

  return (
    <div className="card-2 p-3">
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy !== null}
          onClick={() => act("scan", "/api/scan", { batch_code: code, as: "reliant" })}
          className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs transition hover:bg-emerald-500/10 disabled:opacity-50"
        >
          📷 Pharmacy scan (registered wallet)
        </button>
        <button
          disabled={busy !== null}
          onClick={() => act("pub", "/api/scan", { batch_code: code, as: "relay", city: "Pune" })}
          className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs transition hover:bg-emerald-500/10 disabled:opacity-50"
        >
          🧍 I checked this — public scan
        </button>
        <button
          disabled={busy !== null}
          onClick={() =>
            act("report", "/api/flag", {
              batch_code: code,
              kind: "counterfeit_report",
              severity: 2,
              title: "Suspicious units reported by a buyer",
              detail: "Submitted from the batch page. Demo report — synthetic data.",
            })
          }
          className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs transition hover:bg-amber-500/10 disabled:opacity-50"
        >
          🚩 Report suspicious
        </button>
        <button
          onClick={copyLink}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs transition hover:bg-white/5"
        >
          🔗 Copy link to share
        </button>
      </div>
      {msg && (
        <div className="mono mt-2 text-[11px] text-[var(--muted)]">{msg}</div>
      )}
    </div>
  );
}
