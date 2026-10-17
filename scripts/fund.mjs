#!/usr/bin/env node
// Asli — fund the demo signers from your own wallet.
//
// Reads FUNDER_PRIVATE_KEY from .env.local (paste it there yourself, locally —
// never in chat or code), then sends testnet GLM to each demo signer below a
// minimum balance.
//
// Usage: npm run wallets:fund [amount]   (default 0.05 GLM per signer)

import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  isAddress,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
const ENV_PATH = ".env.local";
const TARGET = process.argv[2] ?? "0.05";

const tiramisu = {
  id: 7738577,
  name: "Arkiv Tiramisu Testnet",
  nativeCurrency: { name: "GLM", symbol: "GLM", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

if (!existsSync(ENV_PATH)) {
  console.error("No .env.local found. Run `npm run wallets:new` first.");
  process.exit(1);
}

const env = readFileSync(ENV_PATH, "utf8");

// Some wallets (e.g. Brave) export bare hex with no 0x prefix, and people
// sometimes paste values wrapped in quotes — normalize both before viem sees it.
const sanitizeValue = (raw) => {
  if (!raw) return undefined;
  let v = raw.trim();
  for (let i = 0; i < 3; i++) {
    const first = v[0];
    const last = v[v.length - 1];
    if (['"', "'", "`", "\u201C", "\u201D", "\u2018", "\u2019"].includes(first)) v = v.slice(1);
    if (['"', "'", "`", "\u201C", "\u201D", "\u2018", "\u2019"].includes(last)) v = v.slice(0, -1);
  }
  v = v.trim();
  if (!/^0x/i.test(v)) v = `0x${v}`;
  return v;
};
const get = (key) => sanitizeValue(env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]);
const isKey = (v) => /^0x[0-9a-fA-F]{64}$/.test(v ?? "");

const funderKey = get("FUNDER_PRIVATE_KEY");
if (funderKey && !isKey(funderKey)) {
  console.error("");
  console.error("FUNDER_PRIVATE_KEY in .env.local is not a valid 64-character hex private key.");
  console.error("It should be the private key of your funded wallet (not its address, not a seed phrase).");
  console.error("");
  process.exit(1);
}
if (!funderKey) {
  console.log("");
  console.log("FUNDER_PRIVATE_KEY is not set in .env.local.");
  console.log("");
  console.log("Two ways to fund the demo signers:");
  console.log("  A) Paste your funded wallet's private key into .env.local as FUNDER_PRIVATE_KEY");
  console.log("     (open the file in your editor — do NOT paste it here), then re-run:");
  console.log("        npm run wallets:fund");
  console.log("  B) Or send GLM manually from your wallet (Brave/MetaMask) to the addresses printed by:");
  console.log("        npm run wallets:new");
  process.exit(0);
}

const roleKeys = [
  "ASLI_MFR_PRIVATE_KEY",
  "ASLI_DIST_PRIVATE_KEY",
  "ASLI_RELIANT_PRIVATE_KEY",
  "ASLI_QM_PRIVATE_KEY",
  "ASLI_RELAY_PRIVATE_KEY",
  "ASLI_FAKE_PRIVATE_KEY",
];

const funder = privateKeyToAccount(funderKey);
const publicClient = createPublicClient({ chain: tiramisu, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account: funder, chain: tiramisu, transport: http(RPC_URL) });

const funderBalance = await publicClient.getBalance({ address: funder.address });
const target = parseEther(TARGET);
console.log("");
console.log(`Funder: ${funder.address}  balance: ${formatEther(funderBalance)} GLM`);
console.log(`Target: ${TARGET} GLM per demo signer`);
console.log("");

let sent = 0n;
for (const key of roleKeys) {
  const pk = get(key);
  if (!pk || !isKey(pk)) {
    console.log(`- ${key}: missing or not valid hex (skipped)`);
    continue;
  }
  const account = privateKeyToAccount(pk);
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance >= target) {
    console.log(`- ${key}: ${account.address}  has ${formatEther(balance)} GLM (ok)`);
    continue;
  }
  const topUp = target - balance;
  if (sent + topUp > funderBalance) {
    console.log(`- ${key}: ${account.address}  needs ${formatEther(topUp)} GLM but funder is short (skipped)`);
    continue;
  }
  const hash = await walletClient.sendTransaction({ to: account.address, value: topUp });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  sent += topUp;
  console.log(`- ${key}: ${account.address}  +${formatEther(topUp)} GLM  (tx ${hash.slice(0, 14)}… block ${receipt.blockNumber})`);
}

console.log("");
console.log(`Done. Sent ${formatEther(sent)} GLM total.`);
console.log("Now run: npm run seed");
