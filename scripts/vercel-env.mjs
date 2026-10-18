#!/usr/bin/env node
// Push the demo signer keys (and the optional Arkiv access key) from
// .env.local into the linked Vercel project's environment variables
// (production + preview).
//
// Values are piped to the Vercel CLI over stdin and are never printed to the
// terminal or written anywhere but Vercel's own env storage.
//
// Usage: npm run vercel:env      (requires `npx vercel login` + `npx vercel link`)

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SIGNER_KEYS = [
  "ASLI_MFR_PRIVATE_KEY",
  "ASLI_DIST_PRIVATE_KEY",
  "ASLI_RELIANT_PRIVATE_KEY",
  "ASLI_QM_PRIVATE_KEY",
  "ASLI_RELAY_PRIVATE_KEY",
  "ASLI_FAKE_PRIVATE_KEY",
];

// Optional: pushed when present. The app runs without them, but the shared
// RPC's anonymous query budget can run out under load — see friction.md #15.
const OPTIONAL_KEYS = ["ARKIV_ACCESS_KEY", "NEXT_PUBLIC_ARKIV_ACCESS_KEY"];

if (!existsSync(".env.local")) {
  console.error("No .env.local found — run `npm run wallets:new` first.");
  process.exit(1);
}

const env = new Map(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")])
);

function push(key, value) {
  for (const target of ["production", "preview"]) {
    execSync(`npx --yes vercel env add ${key} ${target} --force`, {
      input: `${value}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`  ✓ ${key} → ${target}`);
  }
}

for (const key of SIGNER_KEYS) {
  let value = env.get(key);
  if (!value) {
    console.error(`Missing ${key} in .env.local.`);
    process.exit(1);
  }
  if (!/^0x/i.test(value)) value = `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    console.error(`${key} is not a valid 64-char hex private key.`);
    process.exit(1);
  }
  push(key, value);
}

for (const key of OPTIONAL_KEYS) {
  const value = env.get(key);
  if (!value) {
    console.log(`  – ${key} not in .env.local (optional, skipped)`);
    continue;
  }
  push(key, value);
}

console.log("");
console.log("Done. Redeploy (`npx vercel --prod`) for the values to take effect.");
console.log("The demo write buttons return 503 until the signer env vars exist.");
