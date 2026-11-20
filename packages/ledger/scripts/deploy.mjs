// Deploy the anchor contract wasm to its (already created) account and call `new { owner }`.
// DEFAULT IS DRY RUN. Sends only with --execute AND CONSENT_GUARD_ALLOW_TESTNET_WRITE=1.
//
// Flags (env fallback):
//   --contract <id>     CONSENT_GUARD_ANCHOR_CONTRACT_ID  default consent-guard-anchor.tee-receipts-chamdom.testnet
//   --owner <id>        CONSENT_GUARD_ANCHOR_OWNER_ID     default = contract id
//   --rpc <url>         NEAR_RPC_URL                      default https://rpc.testnet.near.org
//   --credentials <p>   NEAR_CREDENTIALS_FILE             default ~/.near-credentials/testnet/<contract>.json
//   --wasm <path>       default contracts/anchor/res/consent_guard_anchor.wasm
//   --dry-run | --execute
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONTRACT_ID,
  DEFAULT_RPC_URL,
  NETWORK,
  PARENT_ACCOUNT_ID,
  credentialsExist,
  defaultCredentialsPath,
  sendLiveTransaction,
} from "../src/near.ts";
import { parseArgs, printSummary, writeGate } from "./cli-args.mjs";

const flags = parseArgs();
const env = process.env;
const contractId = flags.contract ?? env.CONSENT_GUARD_ANCHOR_CONTRACT_ID ?? DEFAULT_CONTRACT_ID;
const owner = flags.owner ?? env.CONSENT_GUARD_ANCHOR_OWNER_ID ?? contractId;
const rpcUrl = flags.rpc ?? env.NEAR_RPC_URL ?? DEFAULT_RPC_URL;
const credentialsPath = flags.credentials ?? env.NEAR_CREDENTIALS_FILE ?? defaultCredentialsPath(contractId);
const wasmPath = flags.wasm ?? fileURLToPath(new URL("../contracts/anchor/res/consent_guard_anchor.wasm", import.meta.url));

if (contractId === PARENT_ACCOUNT_ID) {
  console.error(`refusing: ${PARENT_ACCOUNT_ID} hosts the TEE receipts contract; deploying here would overwrite it. Use a subaccount.`);
  process.exit(2);
}

const wasmExists = existsSync(wasmPath);
const wasm = wasmExists ? readFileSync(wasmPath) : null;
const gate = writeGate(flags);
const initArgs = { owner };

printSummary(gate.live ? "LIVE DEPLOY" : "DRY RUN — no transaction sent", [
  ["network", NETWORK],
  ["rpc", rpcUrl],
  ["contract account", contractId],
  ["signer", `${contractId} (deploys to itself)`],
  ["credentials path", credentialsPath],
  ["credentials exist", credentialsExist(credentialsPath) ? "yes" : "no"],
  ["wasm path", wasmPath],
  ["wasm size", wasm ? `${wasm.length} bytes` : "MISSING (npm run build:contract)"],
  ["wasm sha256", wasm ? createHash("sha256").update(wasm).digest("hex") : "-"],
  ["actions", "DeployContract(wasm), FunctionCall new (30 Tgas, 0 deposit)"],
  ["init args", initArgs],
]);

if (!gate.live) {
  console.log(`
Prerequisite (EL, at integration): the contract account must exist, e.g.
  near account create-account fund-myself ${contractId} '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as ${PARENT_ACCOUNT_ID} network-config testnet sign-with-legacy-keychain send
Then: CONSENT_GUARD_ALLOW_TESTNET_WRITE=1 node scripts/deploy.mjs --execute (requires near-api-js@^7).`);
  if (gate.refusal) {
    console.error(`\n${gate.refusal}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!wasm) throw new Error(`wasm not found: ${wasmPath}`);
const { txHash } = await sendLiveTransaction({
  rpcUrl,
  signerId: contractId,
  credentialsPath,
  receiverId: contractId,
  buildActions: (near) => [
    near.actions.deployContract(wasm),
    near.actions.functionCall("new", initArgs, near.teraToGas("30"), 0n),
  ],
});
console.log(JSON.stringify({ contract: contractId, owner, txHash }));
