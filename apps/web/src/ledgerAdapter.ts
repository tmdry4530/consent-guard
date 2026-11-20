// MOCK ledger — append-only, sha256 hash-chained, in memory. U2 (packages/ledger)
// will replace this with the real ledger + NEAR testnet anchoring (anchorTx).
import type { LedgerEvent } from "../../../packages/policy/src/types";

export const GENESIS_HASH = "0".repeat(64);

/** Caller-supplied part of an event; seq/prevHash/hash are assigned on append. */
export type LedgerInput = Pick<LedgerEvent, "kind" | "at" | "agentId" | "dataset" | "fields" | "refId">;

/** Canonical JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash over {seq, kind, at, agentId, dataset, fields, refId, prevHash}; excludes hash and anchorTx. */
export function hashEvent(e: Omit<LedgerEvent, "hash" | "anchorTx">): Promise<string> {
  const { seq, kind, at, agentId, dataset, fields, refId, prevHash } = e;
  return sha256Hex(canonicalJson({ seq, kind, at, agentId, dataset, fields, refId, prevHash }));
}

export async function createEvent(input: LedgerInput, prev: LedgerEvent | undefined): Promise<LedgerEvent> {
  const unhashed = {
    seq: prev ? prev.seq + 1 : 1,
    kind: input.kind,
    at: input.at,
    agentId: input.agentId,
    dataset: input.dataset,
    fields: [...input.fields],
    refId: input.refId,
    prevHash: prev ? prev.hash : GENESIS_HASH,
  };
  return { ...unhashed, hash: await hashEvent(unhashed) };
}

/** Returns a new chain with the inputs appended in order; never mutates `chain`. */
export async function append(chain: readonly LedgerEvent[], inputs: readonly LedgerInput[]): Promise<LedgerEvent[]> {
  const next = [...chain];
  for (const input of inputs) next.push(await createEvent(input, next[next.length - 1]));
  return next;
}

export async function verifyChain(chain: readonly LedgerEvent[]): Promise<boolean> {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i + 1 || e.prevHash !== prevHash) return false;
    if ((await hashEvent(e)) !== e.hash) return false;
    prevHash = e.hash;
  }
  return true;
}

/** Events in display order: newest first by default. */
export function list(chain: readonly LedgerEvent[], order: "newest" | "oldest" = "newest"): LedgerEvent[] {
  return order === "newest" ? [...chain].reverse() : [...chain];
}
