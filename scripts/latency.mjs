// Quick latency probe for the Tiramisu RPC — run: node scripts/latency.mjs
import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { str } from "@arkiv-network/sdk/attr";
import { eq } from "@arkiv-network/sdk/query";
import { http } from "viem";

const RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
const client = createPublicClient({ chain: tiramisu, transport: http(RPC) });

async function time(label, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`${label}: ${Date.now() - t0} ms`);
    return r;
  } catch (e) {
    console.log(`${label}: ${Date.now() - t0} ms FAILED — ${e?.shortMessage ?? e?.message ?? e}`);
    return null;
  }
}

// warm the connection
await time("blockNumber #1 (cold)", () => client.getBlockNumber());
await time("blockNumber #2", () => client.getBlockNumber());
await time("blockNumber #3", () => client.getBlockNumber());

for (const [label, type] of [
  ["asli.batch", "asli.batch"],
  ["asli.custody", "asli.custody"],
  ["asli.flag", "asli.flag"],
  ["asli.registry", "asli.registry"],
]) {
  await time(`select type=${label} (limit 20)`, async () => {
    const page = await client.select("*").where(eq("type", str(type))).limit(20).fetch();
    console.log(`   → ${page.entities.length} entities (first page)`);
  });
}

await time("select batch_code=GF5-26A-0142", async () => {
  const page = await client.select("*").where(eq("batch_code", str("GF5-26A-0142"))).limit(100).fetch();
  console.log(`   → ${page.entities.length} entities`);
});
