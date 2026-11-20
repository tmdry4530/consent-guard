// Node-only NEAR helpers: defaults, credential path checks, and the opt-in live send path.
// The live path is never reached unless a caller passes dryRun:false explicitly; tests never do.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NETWORK = "testnet";
export const DEFAULT_RPC_URL = "https://rpc.testnet.near.org";
export const FASTNEAR_RPC_URL = "https://rpc.testnet.fastnear.com";
/** Existing TEE receipts contract account. NEVER deploy to it; it is only the parent of the anchor subaccount. */
export const PARENT_ACCOUNT_ID = "tee-receipts-chamdom.testnet";
export const DEFAULT_CONTRACT_ID = `consent-guard-anchor.${PARENT_ACCOUNT_ID}`;
export const ANCHOR_GAS_TGAS = 30;

export function defaultCredentialsPath(accountId: string, network: string = NETWORK): string {
  return join(homedir(), ".near-credentials", network, `${accountId}.json`);
}

/** Existence check by path only; never reads the file. */
export function credentialsExist(path: string): boolean {
  return existsSync(path);
}

export interface LiveSendOptions {
  rpcUrl: string;
  signerId: string;
  credentialsPath: string;
  receiverId: string;
  /** Builds near-api-js actions from the loaded module. */
  buildActions: (near: NearApi) => unknown[];
}

// Minimal shape of near-api-js v7 used here (same calls as tee-receipts/client).
export interface NearApi {
  Account: new (accountId: string, provider: unknown, signer: unknown) => {
    signAndSendTransaction(o: { receiverId: string; actions: unknown[] }): Promise<{
      status?: { Failure?: unknown; SuccessValue?: string };
      transaction: { hash: string };
    }>;
  };
  JsonRpcProvider: new (o: { url: string }) => unknown;
  KeyPairSigner: { fromSecretKey(key: string): unknown };
  actions: {
    functionCall(method: string, args: object, gas: bigint, deposit: bigint): unknown;
    deployContract(code: Uint8Array): unknown;
  };
  teraToGas(tgas: string): bigint;
}

async function loadNearApi(): Promise<NearApi> {
  // Dynamic on purpose: near-api-js is optional (not installed by default), so a static import would
  // make every dry-run/test fail to load. Only the explicit live path needs it.
  const spec = "near-api-js";
  try {
    return (await import(spec)) as NearApi;
  } catch {
    throw new Error("live send needs near-api-js@^7: run `npm i -w @consent-guard/ledger near-api-js@^7` first");
  }
}

/** Signs and sends one transaction. Reads the private key from the credentials file; never prints it. */
export async function sendLiveTransaction(o: LiveSendOptions): Promise<{ txHash: string; successValue: string | null }> {
  if (!credentialsExist(o.credentialsPath)) throw new Error(`credentials file not found: ${o.credentialsPath}`);
  const near = await loadNearApi();
  const { private_key: privateKey } = JSON.parse(readFileSync(o.credentialsPath, "utf8")) as { private_key?: string };
  if (!privateKey) throw new Error(`credentials file has no private_key: ${o.credentialsPath}`);
  const account = new near.Account(o.signerId, new near.JsonRpcProvider({ url: o.rpcUrl }), near.KeyPairSigner.fromSecretKey(privateKey));
  const outcome = await account.signAndSendTransaction({ receiverId: o.receiverId, actions: o.buildActions(near) });
  if (outcome.status?.Failure) throw new Error(`transaction failed: ${JSON.stringify(outcome.status.Failure)}`);
  return { txHash: outcome.transaction.hash, successValue: outcome.status?.SuccessValue ?? null };
}
