#!/usr/bin/env node
// Push the six demo signer keys from .env.local into the linked Vercel
// project's environment variables (production + preview).
//
// Keys are piped to the Vercel CLI over stdin and are never printed to the
// terminal or written anywhere but Vercel's own env storage.
//
// Usage: npm run vercel:env      (requires `npx vercel login` + `npx vercel link`)

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const KEYS = [
  "ASLI_MFR_PRIVATE_KEY",
  "ASLI_DIST_PRIVATE_KEY",
  "ASLI_RELIANT_PRIVATE_KEY",
  "ASLI_QM_PRIVATE_KEY",
  "ASLI_RELAY_PRIVATE_KEY",
  "ASLI_FAKE_PRIVATE_KEY",
];

if (!existsSync(".env.local")) {
  console.error("No .env.local found — run `npm run wallets:new` first.");
  process.exit(1);
}
const env = readFileSync(".env.local", "utf8");

for (const key of KEYS) {
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) {
    console.error(`Missing ${key} in .env.local.`);
    process.exit(1);
  }
  let value = m[1].trim().replace(/^["']|["']$/g, "");
  if (!/^0x/i.test(value)) value = `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    console.error(`${key} is not a valid 64-char hex private key.`);
    process.exit(1);
  }
  for (const target of ["production", "preview"]) {
    execSync(`npx --yes vercel env add ${key} ${target} --force`, {
      input: `${value}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`  ✓ ${key} → ${target}`);
  }
}

console.log("");
console.log("Done. Redeploy (`npx vercel --prod`) for the values to take effect.");
console.log("The demo write buttons return 503 until the env vars exist.");
