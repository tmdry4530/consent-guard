// NEAR testnet anchor settings for the audit-log anchor status (read-only public RPC view call).
// Build-time overrides: VITE_NEAR_RPC_URL, VITE_ANCHOR_CONTRACT_ID, VITE_ANCHOR_TX_URL (full URL or tx hash),
// VITE_EXPLORER_BASE. Runtime overrides (screenshots/mocks, no rebuild): `?rpc=<url>&contract=<id>`.

export interface AnchorConfig {
  rpcUrl: string;
  contractId: string;
  /** Explorer link to the anchor tx for the sample snapshot. */
  txUrl: string;
  /** Explorer link to the anchor contract account. */
  accountUrl: string;
  timeoutMs: number;
}

export const DEFAULT_RPC_URL = "https://rpc.testnet.near.org";
export const DEFAULT_CONTRACT_ID = "consent-guard-anchor.tee-receipts-chamdom.testnet";
export const DEFAULT_EXPLORER_BASE = "https://testnet.nearblocks.io";
export const DEFAULT_ANCHOR_TX = "Gx1HfEQYRQh9RwLr1DJstmV6m6dJEaCFQ3RnXM39bHhE";
export const DEFAULT_TIMEOUT_MS = 5000;

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
  };
}

/** Config for the running app; safe where import.meta.env or location is missing (tsx tests). */
export function anchorConfig(): AnchorConfig {
  // Typed non-optional by vite/client, but undefined under tsx (tests).
  const env: Env = import.meta.env ?? {};
  return resolveAnchorConfig(env, globalThis.location?.search ?? "");
}
