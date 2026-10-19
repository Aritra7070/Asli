// Print the demo signer addresses (public info) derived from .env.local —
// used when filling the Devfolio "wallet addresses that create your Arkiv
// entities" question. Run: node scripts/addresses.mjs
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const ROLES = {
  ASLI_MFR_PRIVATE_KEY:
    "MFR — Aushadh Labs (synthetic manufacturer): batch attestations, recalls",
  ASLI_DIST_PRIVATE_KEY:
    "DIST — MedRoute Logistics (synthetic distributor): custody hops",
  ASLI_RELIANT_PRIVATE_KEY:
    "RELIANT — Reliant Pharmacy, Pune: scans + pharmacy registry",
  ASLI_QM_PRIVATE_KEY:
    "QM — QuickMeds Hub, Gurugram: quick-commerce custody",
  ASLI_RELAY_PRIVATE_KEY:
    "RELAY — Asli Scan Relay: anonymous public patient scans (city-level only)",
  ASLI_FAKE_PRIVATE_KEY:
    "FAKE — unregistered seller: the demo counterfeit shipper",
};

const env = readFileSync(".env.local", "utf8");
for (const [key, desc] of Object.entries(ROLES)) {
  const m = env.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) {
    console.log(`${key}: missing`);
    continue;
  }
  const pk = m[1].trim().replace(/^["']|["']$/g, "");
  const addr = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`).address;
  console.log(`${addr}  ${desc}`);
}

const f = env.match(/^FUNDER_PRIVATE_KEY=(.*)$/m);
if (f) {
  const pk = f[1].trim().replace(/^["']|["']$/g, "");
  const addr = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`).address;
  console.log(`${addr}  FUNDER — funds the signers (does not create entities)`);
}
