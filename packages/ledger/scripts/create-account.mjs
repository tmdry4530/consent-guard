// Create the Consent Guard anchor subaccount on NEAR testnet, funded by the parent.
// DEFAULT IS DRY RUN. Sends only with --execute AND CONSENT_GUARD_ALLOW_TESTNET_WRITE=1.
//
// Generates a keypair (if the credentials file is missing), writes it with mode 0600,
// and never prints private key material. The near CLI is given only the public key
// (use-manually-provided-public-key) and signs with the parent's legacy keychain.
//
// Flags (env fallback):
//   --account <id>      CONSENT_GUARD_ANCHOR_CONTRACT_ID  default consent-guard-anchor.tee-receipts-chamdom.testnet
//   --parent <id>       CONSENT_GUARD_ANCHOR_PARENT_ID    default tee-receipts-chamdom.testnet
//   --amount <NEAR>     CONSENT_GUARD_ANCHOR_FUND_NEAR    default 3
//   --credentials <p>   NEAR_CREDENTIALS_FILE             default ~/.near-credentials/testnet/<account>.json
//   --rpc <url>         NEAR_RPC_URL
//   --dry-run | --execute
import { existsSync, mkdirSync, writeFileSync, chmodSync, renameSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  DEFAULT_CONTRACT_ID,
  DEFAULT_RPC_URL,
  NETWORK,
  PARENT_ACCOUNT_ID,
  credentialsExist,
  defaultCredentialsPath,
} from "../src/near.ts";
import { parseArgs, printSummary, writeGate } from "./cli-args.mjs";
import { redact } from "./redact.mjs";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const size = Math.ceil((bytes.length * 138) / 100) + 1;
  const buf = new Uint8Array(size);
  for (const byte of bytes) {
    let carry = byte;
    for (let j = size - 1; j >= 0; j--) {
      carry += 256 * buf[j];
      buf[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
  }
  let i = 0;
  while (i < size && buf[i] === 0) i++;
  return "1".repeat(zeros) + [...buf.subarray(i)].map((n) => B58[n]).join("");
}

function generateNearKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32);
  const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const secret = Buffer.concat([seed, pub]);
  return { publicKey: `ed25519:${b58encode(pub)}`, privateKey: `ed25519:${b58encode(secret)}` };
}

function writeCredentialsAtomic(path, accountId, keypair) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  const body = JSON.stringify({ account_id: accountId, public_key: keypair.publicKey, private_key: keypair.privateKey }, null, 2);
  writeFileSync(tmp, body, { mode: 0o600, flag: "wx" });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  return keypair.publicKey;
}

function publicKeyFromFile(path) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  if (typeof j.public_key !== "string" || !j.public_key.startsWith("ed25519:")) {
    throw new Error(`credentials file at ${path} has no public_key`);
  }
  return j.public_key;
}

function runNear(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("near", args, { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => { out += b.toString("utf8"); });
    child.stderr.on("data", (b) => { err += b.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

const flags = parseArgs();
const env = process.env;
const accountId = flags.account ?? flags.contract ?? env.CONSENT_GUARD_ANCHOR_CONTRACT_ID ?? DEFAULT_CONTRACT_ID;
const parentId = flags.parent ?? env.CONSENT_GUARD_ANCHOR_PARENT_ID ?? PARENT_ACCOUNT_ID;
const amountNear = flags.amount ?? env.CONSENT_GUARD_ANCHOR_FUND_NEAR ?? "3";
const rpcUrl = flags.rpc ?? env.NEAR_RPC_URL ?? DEFAULT_RPC_URL;
const credentialsPath = flags.credentials ?? env.NEAR_CREDENTIALS_FILE ?? defaultCredentialsPath(accountId);
const parentCredentialsPath = flags["parent-credentials"] ?? defaultCredentialsPath(parentId);
const gate = writeGate(flags);

if (accountId === PARENT_ACCOUNT_ID || accountId === parentId) {
  console.error(`refusing: will not create or fund ${accountId} as if it were a new contract account (would collide with the parent / TEE receipts account).`);
  process.exit(2);
}

printSummary(gate.live ? "LIVE CREATE-ACCOUNT" : "DRY RUN — no transaction sent", [
  ["network", NETWORK],
  ["rpc", rpcUrl],
  ["new account", accountId],
  ["fund from (parent)", parentId],
  ["initial balance", `${amountNear} NEAR`],
  ["parent credentials path", parentCredentialsPath],
  ["parent credentials exist", credentialsExist(parentCredentialsPath) ? "yes" : "no"],
  ["new credentials path", credentialsPath],
  ["new credentials exist", credentialsExist(credentialsPath) ? "yes" : "no"],
  ["actions", `CreateAccount + AddKey(public only) + Transfer ${amountNear} NEAR`],
  ["note", "private keys are never printed; new key file is written mode 0600 only on --execute if missing"],
]);

if (!gate.live) {
  if (gate.refusal) {
    console.error(`\n${gate.refusal}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!credentialsExist(parentCredentialsPath)) {
  console.error(`parent credentials file not found: ${parentCredentialsPath}`);
  process.exit(2);
}

let publicKey;
if (credentialsExist(credentialsPath)) {
  publicKey = publicKeyFromFile(credentialsPath);
  console.log(`using existing credentials file (path only): ${credentialsPath}`);
} else {
  const kp = generateNearKeypair();
  publicKey = writeCredentialsAtomic(credentialsPath, accountId, kp);
  console.log(`wrote new credentials file mode 0600: ${credentialsPath}`);
}
console.log(`public key: ${publicKey}`);

const args = [
  "account", "create-account", "fund-myself", accountId, `${amountNear} NEAR`,
  "use-manually-provided-public-key", publicKey,
  "sign-as", parentId,
  "network-config", NETWORK,
  "sign-with-legacy-keychain",
  "send",
];
console.log(`running: near ${args.join(" ")}`);

const result = await runNear(args);
console.log(redact((result.out || "") + (result.err ? `\n${result.err}` : "")));
if (result.code !== 0) {
  console.error(`near CLI exited ${result.code}`);
  process.exit(result.code || 1);
}
