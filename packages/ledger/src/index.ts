// Node entry point. Chain logic lives in core.js (shared with the browser verify page);
// this adds a synchronous node:crypto sha256 and node-bound conveniences.
import { createHash } from "node:crypto";
import {
  append,
  appendEvent,
  appendToChain,
  buildChain,
  createEvent,
  verifyChain,
  type LedgerEvent,
  type LedgerEventInput,
  type VerifyResult,
} from "./core.js";

export * from "./core.js";
export { createAnchorAdapter } from "./anchor.ts";
export { DEFAULT_CONTRACT_ID, DEFAULT_RPC_URL, FASTNEAR_RPC_URL, PARENT_ACCOUNT_ID } from "./near.ts";

export function nodeSha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const node = {
  verifyChain: (events: readonly LedgerEvent[]): Promise<VerifyResult> => verifyChain(events, nodeSha256Hex),
  createEvent: (input: LedgerEventInput, prev: LedgerEvent | undefined): Promise<LedgerEvent> => createEvent(input, prev, nodeSha256Hex),
  appendEvent: (events: readonly LedgerEvent[], input: LedgerEventInput): Promise<LedgerEvent> => appendEvent(events, input, nodeSha256Hex),
  appendToChain: (events: readonly LedgerEvent[], input: LedgerEventInput): Promise<LedgerEvent[]> => appendToChain(events, input, nodeSha256Hex),
  append: (chain: readonly LedgerEvent[], inputs: readonly LedgerEventInput[]): Promise<LedgerEvent[]> => append(chain, inputs, nodeSha256Hex),
  buildChain: (inputs: readonly LedgerEventInput[]): Promise<LedgerEvent[]> => buildChain(inputs, nodeSha256Hex),
};
