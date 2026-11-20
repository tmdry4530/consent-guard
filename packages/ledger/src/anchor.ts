// Anchor adapter: dry-run by default; reads go to a public RPC via injectable fetch.
import { fetchAnchor, normalizeHeadHash, type AnchorView, type FetchLike } from "./core.js";
import {
  ANCHOR_GAS_TGAS,
  DEFAULT_CONTRACT_ID,
  DEFAULT_RPC_URL,
  NETWORK,
  credentialsExist,
  defaultCredentialsPath,
  sendLiveTransaction,
} from "./near.ts";

export interface AnchorAdapterOptions {
  rpcUrl?: string;
  contractId?: string;
  /** Signer; must be the contract owner for anchor() to succeed on-chain. */
  accountId?: string;
  credentialsPath?: string;
  /** Default true. false enables the live send path (still requires credentials). */
  dryRun?: boolean;
  fetchImpl?: FetchLike;
}

export interface AnchorCall {
  network: string;
  rpcUrl: string;
  contractId: string;
  signerId: string;
  credentialsPath: string;
  credentialsExist: boolean;
  method: "anchor";
  args: { head_hash: string; count: number };
  gasTgas: number;
  deposit: "0";
}

export type AnchorResult = (AnchorCall & { dryRun: true }) | (AnchorCall & { dryRun: false; txHash: string });

export function createAnchorAdapter(opts: AnchorAdapterOptions = {}) {
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
  const contractId = opts.contractId ?? DEFAULT_CONTRACT_ID;
  const accountId = opts.accountId ?? contractId;
  const credentialsPath = opts.credentialsPath ?? defaultCredentialsPath(accountId);
  const dryRun = opts.dryRun ?? true;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);

  function describe(headHash: string, count: number): AnchorCall {
    const head = normalizeHeadHash(headHash);
    if (!head) throw new TypeError(`headHash must be 64 hex chars: ${headHash}`);
    if (!Number.isSafeInteger(count) || count <= 0) throw new TypeError(`count must be a positive integer: ${count}`);
    return {
      network: NETWORK,
      rpcUrl,
      contractId,
      signerId: accountId,
      credentialsPath,
      credentialsExist: credentialsExist(credentialsPath),
      method: "anchor",
      args: { head_hash: head, count },
      gasTgas: ANCHOR_GAS_TGAS,
      deposit: "0",
    };
  }

  return {
    dryRun,
    rpcUrl,
    contractId,
    describe,
    async anchor(headHash: string, count: number): Promise<AnchorResult> {
      const call = describe(headHash, count);
      if (dryRun) return { ...call, dryRun: true };
      const { txHash } = await sendLiveTransaction({
        rpcUrl,
        signerId: accountId,
        credentialsPath,
        receiverId: contractId,
        buildActions: (near) => [near.actions.functionCall("anchor", call.args, near.teraToGas(String(ANCHOR_GAS_TGAS)), 0n)],
      });
      return { ...call, dryRun: false, txHash };
    },
    readAnchor(): Promise<AnchorView | null> {
      return fetchAnchor({ rpcUrl, contractId, fetchImpl });
    },
  };
}
