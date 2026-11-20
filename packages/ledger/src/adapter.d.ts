import type { LedgerEvent } from "../../policy/src/types.ts";
import type { Sha256Hex } from "./core.js";

export type LedgerInput = Pick<LedgerEvent, "kind" | "at" | "agentId" | "dataset" | "fields" | "refId">;
export const GENESIS_HASH: string;
export function canonicalJson(value: unknown): string;
export function hashEvent(e: Omit<LedgerEvent, "hash" | "anchorTx">, sha256?: Sha256Hex): Promise<string>;
export function createEvent(input: LedgerInput, prev: LedgerEvent | undefined, sha256?: Sha256Hex): Promise<LedgerEvent>;
export function append(chain: readonly LedgerEvent[], inputs: readonly LedgerInput[], sha256?: Sha256Hex): Promise<LedgerEvent[]>;
export function verifyChain(chain: readonly LedgerEvent[], sha256?: Sha256Hex): Promise<boolean>;
export function list(chain: readonly LedgerEvent[], order?: "newest" | "oldest"): LedgerEvent[];
