"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SearchBar() {
  const [q, setQ] = useState("");
  const router = useRouter();

  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const code = q.trim().toUpperCase();
        if (code) router.push(`/b/${encodeURIComponent(code)}`);
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Batch code on the strip — e.g. GF5-26A-0142"
        className="mono w-full rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm outline-none focus:border-emerald-500/60"
        aria-label="Batch code"
      />
      <button
        type="submit"
        className="rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
      >
        Verify
      </button>
    </form>
  );
}
