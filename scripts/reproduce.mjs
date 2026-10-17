#!/usr/bin/env node
// Asli — independent verifier. Reads the chain directly (no keys, no app
// server) and prints what the demo world actually contains, using the same
// rules the UI uses. If this script and the website disagree, the website is
// wrong: the chain is the source of truth.
//
// Usage: npm run reproduce

import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/attr";
import { http } from "viem";

const RPC_URL = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
const CODES = ["GF5-26A-0142", "AMX-500-26C-0311", "FX650-25J-0881"];

const client = createPublicClient({ chain: tiramisu, transport: http(RPC_URL) });
const SEL = {
  key: true,
  creator: true,
  createdAt: true,
  expiresAt: true,
  creationFlags: true,
  payload: true,
  attributes: true,
};

const a = (e, name) => e.attributes?.[name]?.value;
const num = (e, name) => {
  const v = a(e, name);
  return typeof v === "bigint" ? Number(v) : v;
};

async function all(expr) {
  let page = await client.select(SEL).where(expr).limit(200).fetch();
  const out = [...page.entities];
  let guard = 0;
  while (page.hasNextPage() && guard++ < 20) {
    page = await page.next();
    out.push(...page.entities);
  }
  return out;
}

console.log("\n=== Asli · independent read of Arkiv Tiramisu ===\n");

const registries = await all(eq("type", str("asli.registry")));
const byWallet = new Map(registries.map((e) => [String(a(e, "wallet_addr")).toLowerCase(), e]));
console.log(`Registry (self-signed entries):`);
for (const e of registries) {
  console.log(
    `  ${String(a(e, "name")).padEnd(24)} ${String(a(e, "role")).padEnd(13)} ${String(a(e, "city")).padEnd(10)} ${e.creator}`
  );
}

let failures = 0;

for (const code of CODES) {
  const entities = await all(eq("batch_code", str(code)));
  const batches = entities.filter((e) => a(e, "type") === "asli.batch");
  const custody = entities.filter((e) => a(e, "type") === "asli.custody");
  const flags = entities.filter((e) => a(e, "type") === "asli.flag");

  console.log(`\nBatch ${code} — ${entities.length} entities`);
  const creators = new Set();
  for (const b of batches) {
    creators.add(b.creator.toLowerCase());
    const reg = byWallet.get(b.creator.toLowerCase());
    console.log(
      `  attestation  by ${b.creator}  ${reg ? `[REGISTERED: ${a(reg, "name")}]` : "[UNREGISTERED]"}` +
        (a(b, "canonical") === true ? "  (canonical)" : "")
    );
  }
  console.log(`  custody hops: ${custody.length}`);
  for (const c of custody.sort((x, y) => num(x, "at_ms") - num(y, "at_ms"))) {
    console.log(
      `    hop ${a(c, "hop")} · ${String(a(c, "actor_kind")).padEnd(12)} ${String(a(c, "city")).padEnd(10)} ${c.creator}`
    );
  }
  console.log(`  flags: ${flags.length}`);
  for (const f of flags) {
    console.log(
      `    ${String(a(f, "kind")).padEnd(18)} severity ${a(f, "severity")}` +
        `  readonly=${f.creationFlags?.readonly} permissionlessExtension=${f.creationFlags?.permissionlessExtension}`
    );
  }

  const registered = [...creators].filter((c) => byWallet.has(c)).length;
  const unregistered = creators.size - registered;
  const recalled = flags.some(
    (f) => a(f, "kind") === "recall" && Number(a(f, "severity")) >= 3
  );
  const verdict = recalled
    ? "RECALLED"
    : unregistered > 0 && registered > 0
      ? "COUNTERFEIT EXPOSURE (structured + unregistered attestations)"
      : registered > 0
        ? "VERIFIED"
        : "UNVERIFIED";

  console.log(`  → verdict: ${verdict}`);
  if (entities.length === 0) failures++;
}

const total = await client.getEntityCount();
console.log(`\nTotal live entities on Tiramisu: ${total}`);
console.log(
  failures === 0
    ? "\nOK — both demo batches verified directly from the chain.\n"
    : "\nFAILED — some demo batches are missing. Run `npm run seed`.\n"
);
process.exit(failures === 0 ? 0 : 1);
