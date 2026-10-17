// Entity shapes and the verification report the whole UI renders from.

import type { VerdictKind } from "@/lib/constants";

/** Loose structural type for an entity read from the chain. */
export type ChainEntityLike = {
  key: string;
  owner: string;
  creator: string;
  createdAt: bigint;
  updatedAt?: bigint;
  expiresAt: bigint;
  creationFlags?: {
    readonly: boolean;
    permissionlessExtension: boolean;
    raw: number;
  };
  contentType?: string;
  payload?: Uint8Array;
  attributes?: Record<string, { type: string; value: unknown }>;
};

export type Registry = {
  wallet: string;
  name: string;
  city: string;
  role: string; // manufacturer | distributor | pharmacy | relay
  sinceMs?: number;
  entityKey: string;
  registeredAtBlock: bigint;
};

export type Attestation = {
  entityKey: string;
  creator: string;
  blob: string; // creator short form, filled at render time
  drugCode?: string;
  drugName?: string;
  status?: string;
  canonical: boolean;
  units?: number;
  expAtMs?: number;
  mfgAtMs?: number;
  city?: string;
  note?: string;
  createdAtBlock: bigint;
  expiresAtBlock: bigint;
  payload: Record<string, unknown>;
};

export type TrailEntry = {
  entityKey: string;
  creator: string;
  hop?: number;
  city?: string;
  actorKind?: string;
  atMs?: number;
  note?: string;
  createdAtBlock: bigint;
};

export type FlagRecord = {
  entityKey: string;
  creator: string;
  kind: string; // recall | counterfeit_report | expiry_report
  severity: number;
  batchCode?: string;
  city?: string;
  title?: string;
  detail?: string;
  atMs?: number;
  readonly: boolean;
  permissionlessExtension: boolean;
  createdAtBlock: bigint;
  expiresAtBlock: bigint;
};

export type BatchReport = {
  code: string;
  found: boolean;
  head: bigint;
  verdict: {
    kind: VerdictKind;
    registeredSigners: number;
    unregisteredSigners: number;
    blockedByRecall?: FlagRecord;
  };
  attestations: Attestation[];
  trail: TrailEntry[];
  flags: FlagRecord[];
  registries: Record<string, Registry>;
  stats: {
    scans: number;
    cities: string[];
    lastActivityMs?: number;
  };
};

export type FeedItem = {
  entityKey: string;
  kind: "batch" | "custody" | "flag" | "registry";
  title: string;
  sub: string;
  creator: string;
  atBlock: bigint;
  atMs: number;
};

export type RadarData = {
  head: bigint;
  expiringSoon: Array<{
    code: string;
    drugName?: string;
    expAtMs?: number;
    daysLeft: number;
    status?: string;
    canonical: boolean;
    creator: string;
  }>;
  recalls: FlagRecord[];
  cityCounts: Array<{ city: string; count: number }>;
  totals: { batches: number; scans: number; flags: number; registries: number };
};
