// Quick health probe for the shared Tiramisu RPC — run: npm run rpc:health
//
// WHY THIS EXISTS (arkiv/friction.md #15): when the anonymous query budget is
// exhausted, the HTTP surface HANGS while the WebSocket surface returns the
// real error instantly. This probe asks both, and it uses the access key from
// .env.local when present — so you can tell "we're over budget" apart from
// "the node is slow" in seconds. Run it before recording a demo.
import { readFileSync } from "node:fs";
import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { str } from "@arkiv-network/sdk/attr";
import { eq } from "@arkiv-network/sdk/query";
import { http, webSocket } from "viem";

// Tiny .env.local reader (this script runs outside Next.js).
let KEY =
  process.env.ARKIV_ACCESS_KEY ??
  process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ??
  "";
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^(ARKIV_ACCESS_KEY|NEXT_PUBLIC_ARKIV_ACCESS_KEY)=(.*)$/);
    if (m && m[2].trim()) {
      KEY = m[2].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }
} catch {
  // no .env.local — probe anonymously
}

const HTTP = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
const WS = "wss://rpc.tiramisu.db-chain.testnet.arkiv.network";
const withKey = (u) =>
  KEY ? `${u.replace(/\/+$/, "")}/${encodeURIComponent(KEY)}` : u;

console.log(
  KEY
    ? "access key: set (from .env.local)"
    : "access key: NOT set — anonymous budget, can be exhausted under load"
);

function race(ms, p) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`no response in ${ms} ms`)), ms);
    }),
  ]);
}

// 1. WebSocket surface — reveals budget errors instantly.
{
  const t0 = Date.now();
  try {
    const ws = createPublicClient({
      chain: tiramisu,
      transport: webSocket(withKey(WS)),
    });
    const page = await race(
      8_000,
      ws.select("*").where(eq("type", str("asli.registry"))).limit(5).fetch()
    );
    console.log(`WS   query: ${Date.now() - t0} ms — OK (${page.entities.length} entities)`);
  } catch (e) {
    console.log(
      `WS   query: ${Date.now() - t0} ms — FAILED: ${e?.shortMessage ?? e?.message ?? e}`
    );
  }
}

// 2. HTTP surface — what the app itself uses.
const client = createPublicClient({
  chain: tiramisu,
  transport: http(HTTP, KEY ? { fetchOptions: { headers: { "X-API-KEY": KEY } } } : {}),
});

async function time(label, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`${label}: ${Date.now() - t0} ms`);
    return r;
  } catch (e) {
    console.log(
      `${label}: ${Date.now() - t0} ms FAILED — ${e?.shortMessage ?? e?.message ?? e}`
    );
    return null;
  }
}

await time("HTTP blockNumber #1 (cold)", () => client.getBlockNumber());
await time("HTTP blockNumber #2", () => client.getBlockNumber());

for (const type of ["asli.batch", "asli.custody", "asli.flag", "asli.registry"]) {
  await time(`HTTP select type=${type}`, async () => {
    const page = await race(
      15_000,
      client.select("*").where(eq("type", str(type))).limit(20).fetch()
    );
    console.log(`   → ${page.entities.length} entities`);
  });
}

console.log("");
console.log('Reading: if WS says "budget exhausted", create a key at');
console.log("https://hub.arkiv.network/api-keys and put it in .env.local (both");
console.log("ARKIV_ACCESS_KEY and NEXT_PUBLIC_ARKIV_ACCESS_KEY) — the app picks it");
console.log("up on the next start. If everything says OK, the RPC is healthy.");

process.exit(0);
