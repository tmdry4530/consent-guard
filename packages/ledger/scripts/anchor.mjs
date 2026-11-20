// Anchor the ledger head hash on NEAR. DEFAULT IS DRY RUN.
// Sends only with --execute AND CONSENT_GUARD_ALLOW_TESTNET_WRITE=1.
//
// Flags (env fallback):
//   --events <file>     ledger JSON (array or {events}); default verify/fixtures/sample-chain.json
//   --head <hex> --count <n>   anchor an explicit head instead of --events
//   --contract <id>     CONSENT_GUARD_ANCHOR_CONTRACT_ID  default consent-guard-anchor.tee-receipts-chamdom.testnet
//   --signer <id>       CONSENT_GUARD_ANCHOR_OWNER_ID     default = contract id (must be the contract owner)
//   --rpc <url>         NEAR_RPC_URL                      default https://rpc.testnet.near.org
//   --credentials <p>   NEAR_CREDENTIALS_FILE             default ~/.near-credentials/testnet/<signer>.json
//   --read              also read the current on-chain anchor (public RPC view; no key)
//   --dry-run | --execute
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAnchorAdapter } from "../src/anchor.ts";
import { nodeSha256Hex } from "../src/index.ts";
import { headHash, parseEventsJson, verifyChain } from "../src/core.js";
import { DEFAULT_CONTRACT_ID, DEFAULT_RPC_URL } from "../src/near.ts";
import { parseArgs, printSummary, writeGate } from "./cli-args.mjs";

const flags = parseArgs();
const env = process.env;
const contractId = flags.contract ?? env.CONSENT_GUARD_ANCHOR_CONTRACT_ID ?? DEFAULT_CONTRACT_ID;
const accountId = flags.signer ?? env.CONSENT_GUARD_ANCHOR_OWNER_ID ?? contractId;
const rpcUrl = flags.rpc ?? env.NEAR_RPC_URL ?? DEFAULT_RPC_URL;
const credentialsPath = flags.credentials ?? env.NEAR_CREDENTIALS_FILE;

let head;
let count;
let source;
if (flags.head) {
  head = String(flags.head);
  count = Number(flags.count);
  source = "--head/--count";
} else {
  const file = flags.events ?? fileURLToPath(new URL("../verify/fixtures/sample-chain.json", import.meta.url));
  const events = parseEventsJson(readFileSync(file, "utf8"));
  const check = await verifyChain(events, nodeSha256Hex);
  if (!check.ok) {
    console.error(`ledger invalid at index ${check.index}: ${check.reason}; refusing to anchor`);
    process.exit(1);
  }
  if (!events.length) {
    console.error("ledger is empty; nothing to anchor");
    process.exit(1);
  }
  head = headHash(events);
  count = events.length;
  source = `${file} (chain verified, ${count} events)`;
}

const gate = writeGate(flags);
const adapter = createAnchorAdapter({ rpcUrl, contractId, accountId, credentialsPath, dryRun: !gate.live });
const call = adapter.describe(head, count);

printSummary(gate.live ? "LIVE ANCHOR" : "DRY RUN — no transaction sent", [
  ["network", call.network],
  ["rpc", call.rpcUrl],
  ["contract account", call.contractId],
  ["signer", call.signerId],
  ["credentials path", call.credentialsPath],
  ["credentials exist", call.credentialsExist ? "yes" : "no"],
  ["head source", source],
  ["method", call.method],
  ["args", call.args],
  ["gas / deposit", `${call.gasTgas} Tgas / ${call.deposit}`],
]);

if (flags.read) {
  try {
    console.log(`current on-chain anchor: ${JSON.stringify(await adapter.readAnchor())}`);
  } catch (e) {
    console.log(`current on-chain anchor: unavailable (${e.message})`);
  }
}

if (gate.refusal) {
  console.error(`\n${gate.refusal}`);
  process.exit(1);
}
if (gate.live) console.log(JSON.stringify(await adapter.anchor(head, count)));
