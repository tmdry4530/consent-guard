import type { LedgerEvent, LedgerEventKind } from "../../policy/src/types.ts";

export type { LedgerEvent, LedgerEventKind };

/** sha256 over a UTF-8 string, lowercase hex. May be sync or async. */
export type Sha256Hex = (text: string) => string | Promise<string>;

/** What a caller supplies to append; seq/prevHash/hash are derived, anchorTx is set later. */
export type LedgerEventInput = Omit<LedgerEvent, "seq" | "prevHash" | "hash" | "anchorTx">;
/** Alias used by the U3 web mock (`ledgerAdapter.ts`). */
export type LedgerInput = LedgerEventInput;

export type VerifyResult = { ok: true } | { ok: false; index: number; reason: string };

export interface AnchorView {
  headHash: string;
  count: number;
  blockHeight: number;
  timestampMs: number;
}

export interface AnchorCheck {
  ok: boolean;
  status: "verified" | "no-events" | "chain-invalid" | "no-anchor" | "bad-anchor" | "head-mismatch" | "count-mismatch";
  reason: string;
  index?: number;
  head?: string;
  anchorHead?: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export const GENESIS_PREV_HASH: string;
/** Same value as GENESIS_PREV_HASH; name used by the U3 web mock. */
export const GENESIS_HASH: string;
export const EVENT_KINDS: readonly LedgerEventKind[];

export function canonicalJson(value: unknown): string;
export function webCryptoSha256Hex(text: string): Promise<string>;
export function eventHashPayload(event: LedgerEvent | Omit<LedgerEvent, "hash" | "anchorTx">): string;
export function hashEvent(event: LedgerEvent | Omit<LedgerEvent, "hash" | "anchorTx">, sha256?: Sha256Hex): Promise<string>;
export function computeEventHash(event: LedgerEvent | Omit<LedgerEvent, "hash" | "anchorTx">, sha256?: Sha256Hex): Promise<string>;
export function verifyChain(events: readonly LedgerEvent[], sha256?: Sha256Hex): Promise<VerifyResult>;

export class LedgerChainError extends Error {
  constructor(result: { index: number; reason: string });
  index: number;
  reason: string;
}

export function createEvent(input: LedgerEventInput, prev: LedgerEvent | undefined, sha256?: Sha256Hex): Promise<LedgerEvent>;
export function appendEvent(events: readonly LedgerEvent[], input: LedgerEventInput, sha256?: Sha256Hex): Promise<LedgerEvent>;
export function appendToChain(events: readonly LedgerEvent[], input: LedgerEventInput, sha256?: Sha256Hex): Promise<LedgerEvent[]>;
export function append(chain: readonly LedgerEvent[], inputs: readonly LedgerEventInput[], sha256?: Sha256Hex): Promise<LedgerEvent[]>;
export function buildChain(inputs: readonly LedgerEventInput[], sha256?: Sha256Hex): Promise<LedgerEvent[]>;
export function list(chain: readonly LedgerEvent[], order?: "newest" | "oldest"): LedgerEvent[];
export function headHash(events: readonly LedgerEvent[]): string | null;
export function normalizeHeadHash(raw: unknown): string | null;
export function parseEventsJson(text: string): LedgerEvent[];
export function verifyAgainstAnchor(
  events: readonly LedgerEvent[],
  anchor: { headHash: string; count?: number | null } | null,
  sha256?: Sha256Hex,
): Promise<AnchorCheck>;

/** NEAR JSON-RPC `query` / `call_function` request body. */
export interface ViewRequest {
  jsonrpc: "2.0";
  id: string;
  method: "query";
  params: {
    request_type: "call_function";
    finality: "final";
    account_id: string;
    method_name: string;
    args_base64: string;
  };
}

export function buildViewRequest(contractId: string, methodName: string, args?: unknown): ViewRequest;
export function decodeViewResponse(body: unknown): unknown;
export function normalizeAnchorView(value: unknown): AnchorView | null;
export function fetchAnchor(opts: { rpcUrl: string; contractId: string; fetchImpl?: FetchLike }): Promise<AnchorView | null>;
