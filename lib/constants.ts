// Shared, client-safe constants. No secrets here.

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://rpc.tiramisu.db-chain.testnet.arkiv.network";

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ??
  "wss://rpc.tiramisu.db-chain.testnet.arkiv.network";

// Update after the repo is pushed.
export const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/arkiv-network";

export const ENTITY_TYPE = {
  batch: "batch",
  custody: "custody",
  flag: "flag",
  registry: "registry",
} as const;

// The two synthetic demo batches (and the copy a counterfeiter ships with
// the same batch code — see /arkiv/schema.md).
export const DEMO = {
  heroCode: "GF5-26A-0142", // Glucofine 5 pen — the GLP-1 story (counterfeit contrast)
  heroDrug: "GF5-PEN-5MG",
  quickCode: "FX650-25J-0881", // Feverex 650 — the quick-commerce expiry story
  quickDrug: "FX650-TAB",
  cleanCode: "AMX-500-26C-0311", // Amoxa 500 — the clean happy path
  cleanDrug: "AMX-500-TAB",
} as const;

export type VerdictKind = "verified" | "unverified" | "counterfeit" | "recalled";

export const VERDICT_COPY: Record<
  VerdictKind,
  { label: string; blurb: string }
> = {
  verified: {
    label: "VERIFIED",
    blurb:
      "Attested by a registered supply-chain wallet, with a public custody trail.",
  },
  unverified: {
    label: "UNVERIFIED",
    blurb:
      "No registered wallet has vouched for this batch on Arkiv. Treat with caution.",
  },
  counterfeit: {
    label: "COUNTERFEIT EXPOSURE",
    blurb:
      "Two wallets claim this batch code. Only one is registered — the other copied everything except the signature.",
  },
  recalled: {
    label: "RECALLED",
    blurb:
      "A recall is live on this batch. Recalls here are write-once and cannot be taken down.",
  },
};

export function shorten(addr?: string | null, n = 6): string {
  if (!addr) return "—";
  return `${addr.slice(0, 2 + n)}…${addr.slice(-4)}`;
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 45) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function fmtDateMs(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Convert an Arkiv expiry block to an approximate date, 2s per block. */
export function blockToDate(block: bigint, head: bigint): Date {
  const blocksLeft = block > head ? block - head : 0n;
  return new Date(Date.now() + Number(blocksLeft) * 2000);
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
