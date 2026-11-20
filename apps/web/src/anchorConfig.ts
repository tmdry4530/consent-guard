// NEAR testnet anchor settings for the audit-log anchor status (read-only public RPC view call).
// Build-time overrides: VITE_NEAR_RPC_URL, VITE_ANCHOR_CONTRACT_ID, VITE_ANCHOR_TX_URL (full URL or tx hash),
// VITE_EXPLORER_BASE, VITE_ANCHOR_MOCK=1. Runtime overrides (screenshots/mocks, no rebuild):
// `?rpc=<url>&contract=<id>`, `?mock=1` (offline stand-in: no RPC call, canned final demo anchor).
import type { AnchorView } from "@consent-guard/ledger/core";

export interface AnchorConfig {
  rpcUrl: string;
  contractId: string;
  /** Explorer link to the anchor tx for the final demo ledger head. */
  txUrl: string;
  /** Explorer link to the anchor contract account. */
  accountUrl: string;
  timeoutMs: number;
  /** Offline stand-in: skip the RPC and use mockAnchorView(). */
  mock: boolean;
}

export const DEFAULT_RPC_URL = "https://rpc.testnet.near.org";
export const DEFAULT_CONTRACT_ID = "consent-guard-anchor.tee-receipts-chamdom.testnet";
export const DEFAULT_EXPLORER_BASE = "https://testnet.nearblocks.io";
/** Anchor tx of the final demo ledger head (2026-11-20 22:41:52 KST, block 278,539,285). */
export const DEFAULT_ANCHOR_TX = "51udtFvQ4Po2E4Pj6H2gTTKAvK2VRKCGgBeAN7A25P2y";
/** First anchor (5-event sample fixture, packages/ledger/verify/fixtures/sample-chain.json); history only. */
export const FIRST_ANCHOR_TX = "Gx1HfEQYRQh9RwLr1DJstmV6m6dJEaCFQ3RnXM39bHhE";
/** Final head/count of the full 5-scene demo (fixed clock), as anchored by DEFAULT_ANCHOR_TX. */
export const EXPECTED_FINAL_HEAD = "259dbd26b973e4a7e8252488ce2a4d97d532f8355825b4edc3722c97b20fa95b";
export const EXPECTED_FINAL_COUNT = 11;
export const EXPECTED_ANCHOR_BLOCK = 278_539_285;
export const DEFAULT_TIMEOUT_MS = 5000;
/** Timestamp of the DEFAULT_ANCHOR_TX block (2026-11-20 22:41:52 KST), as in e2e/anchorMock.ts. */
export const MOCK_ANCHOR_TIMESTAMP_MS = Date.UTC(2026, 10, 20, 13, 41, 52);

/** Canned read_anchor result for mock mode: the same final demo anchor as DEFAULT_ANCHOR_TX. */
export function mockAnchorView(): AnchorView {
  return {
    headHash: EXPECTED_FINAL_HEAD,
    count: EXPECTED_FINAL_COUNT,
    blockHeight: EXPECTED_ANCHOR_BLOCK,
    timestampMs: MOCK_ANCHOR_TIMESTAMP_MS,
  };
}

type Env = Partial<Record<string, string | boolean | undefined>>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Pure resolver: `env` is Vite's import.meta.env (or {}), `search` a location.search string. */
export function resolveAnchorConfig(env: Env = {}, search = ""): AnchorConfig {
  const params = new URLSearchParams(search);
  const explorer = (str(env.VITE_EXPLORER_BASE) ?? DEFAULT_EXPLORER_BASE).replace(/\/+$/, "");
  const rpcUrl = str(params.get("rpc")) ?? str(env.VITE_NEAR_RPC_URL) ?? DEFAULT_RPC_URL;
  const contractId = str(params.get("contract")) ?? str(env.VITE_ANCHOR_CONTRACT_ID) ?? DEFAULT_CONTRACT_ID;
  const tx = str(env.VITE_ANCHOR_TX_URL) ?? DEFAULT_ANCHOR_TX;
  return {
    rpcUrl,
    contractId,
    txUrl: /^https?:\/\//.test(tx) ? tx : `${explorer}/txns/${encodeURIComponent(tx)}`,
    accountUrl: `${explorer}/address/${encodeURIComponent(contractId)}`,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    mock: [params.get("mock"), env.VITE_ANCHOR_MOCK].some((v) => v === "1" || v === "true"),
  };
}

/** Config for the running app; safe where import.meta.env or location is missing (tsx tests). */
export function anchorConfig(): AnchorConfig {
  // Typed non-optional by vite/client, but undefined under tsx (tests).
  const env: Env = import.meta.env ?? {};
  return resolveAnchorConfig(env, globalThis.location?.search ?? "");
}
