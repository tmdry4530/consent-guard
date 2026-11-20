// Browser-safe ledger core: canonical JSON, sha256 hash chain, anchor comparison and
// NEAR RPC view encode/decode. No node: builtins; shared verbatim by node tests and verify/.
// Types: core.d.ts.

export const GENESIS_PREV_HASH = "0".repeat(64);
/** Alias of GENESIS_PREV_HASH; same name as the U3 web mock (`ledgerAdapter.ts`). */
export const GENESIS_HASH = GENESIS_PREV_HASH;
export const EVENT_KINDS = Object.freeze(["grant", "access", "deny", "pending", "revoke"]);
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Deterministic JSON: object keys sorted (UTF-16 code unit order, i.e. Array.prototype.sort),
 * array order kept, object keys with undefined values omitted, no whitespace,
 * primitives encoded exactly as JSON.stringify encodes them.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`);
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || value === undefined) {
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function toHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** sha256 hex (lowercase) of the UTF-8 bytes of `text`, via WebCrypto (browser and Node >= 19). */
export async function webCryptoSha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/** The exact string that is hashed for an event: canonical JSON of the chain fields only (`hash` and `anchorTx` omitted). */
export function eventHashPayload(event) {
  const { seq, kind, at, agentId, dataset, fields, refId, prevHash } = event;
  return canonicalJson({ seq, kind, at, agentId, dataset, fields, refId, prevHash });
}

export async function hashEvent(event, sha256 = webCryptoSha256Hex) {
  return sha256(eventHashPayload(event));
}

/** @deprecated alias of hashEvent */
export async function computeEventHash(event, sha256 = webCryptoSha256Hex) {
  return hashEvent(event, sha256);
}

function shapeError(e) {
  if (e === null || typeof e !== "object" || Array.isArray(e)) return "event is not an object";
  if (!Number.isSafeInteger(e.seq) || e.seq < 0) return "seq must be a non-negative integer";
  if (!EVENT_KINDS.includes(e.kind)) return `kind must be one of ${EVENT_KINDS.join("|")}`;
  if (!Number.isFinite(e.at)) return "at must be a number (epoch ms)";
  for (const k of ["agentId", "dataset", "refId"]) if (typeof e[k] !== "string") return `${k} must be a string`;
  if (!Array.isArray(e.fields) || !e.fields.every((f) => typeof f === "string")) return "fields must be a string array";
  if (typeof e.prevHash !== "string" || !HEX64.test(e.prevHash)) return "prevHash must be 64 lowercase hex chars";
  if (typeof e.hash !== "string" || !HEX64.test(e.hash)) return "hash must be 64 lowercase hex chars";
  if (e.anchorTx !== undefined && typeof e.anchorTx !== "string") return "anchorTx must be a string";
  return null;
}

/**
 * Verifies a whole chain. `index` is the first event that is not a valid successor of the
 * events before it, checked in this order: shape, hash recompute, seq === index+1, prevHash link.
 *   edit:      the edited event (hash mismatch)
 *   reorder:   the first moved position (seq mismatch)
 *   deletion:  the event now sitting where the deleted one was (seq mismatch; expected i+1)
 *   insertion: the inserted position if the forged event is malformed/misnumbered/unlinked,
 *              otherwise the next event (its seq/prevHash no longer follow the insert)
 */
export async function verifyChain(events, sha256 = webCryptoSha256Hex) {
  if (!Array.isArray(events)) return { ok: false, index: -1, reason: "events must be an array" };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const bad = shapeError(e);
    if (bad) return { ok: false, index: i, reason: bad };
    const recomputed = await computeEventHash(e, sha256);
    if (recomputed !== e.hash) {
      return { ok: false, index: i, reason: `hash mismatch: stored ${e.hash}, recomputed ${recomputed}` };
    }
    if (e.seq !== i + 1) return { ok: false, index: i, reason: `seq mismatch: expected ${i + 1}, got ${e.seq}` };
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : events[i - 1].hash;
    if (e.prevHash !== expectedPrev) {
      return {
        ok: false,
        index: i,
        reason: i === 0
          ? `genesis prevHash must be ${GENESIS_PREV_HASH}, got ${e.prevHash}`
          : `prevHash mismatch: expected ${expectedPrev} (hash of seq ${i - 1}), got ${e.prevHash}`,
      };
    }
  }
  return { ok: true };
}

export class LedgerChainError extends Error {
  constructor(result) {
    super(`existing chain invalid at index ${result.index}: ${result.reason}`);
    this.name = "LedgerChainError";
    this.index = result.index;
    this.reason = result.reason;
  }
}

/** Build one event from caller fields and the previous event (or genesis if `prev` is missing). Does not verify a chain. */
export async function createEvent(input, prev, sha256 = webCryptoSha256Hex) {
  const unhashed = {
    seq: prev ? prev.seq + 1 : 1,
    kind: input.kind,
    at: input.at,
    agentId: input.agentId,
    dataset: input.dataset,
    fields: [...input.fields],
    refId: input.refId,
    prevHash: prev ? prev.hash : GENESIS_PREV_HASH,
  };
  const event = { ...unhashed, hash: await hashEvent(unhashed, sha256) };
  const bad = shapeError(event);
  if (bad) throw new TypeError(`invalid event input: ${bad}`);
  return event;
}

/** Returns the next event for `input`. Does not mutate `events`. Throws LedgerChainError if `events` is invalid. */
export async function appendEvent(events, input, sha256 = webCryptoSha256Hex) {
  const check = await verifyChain(events, sha256);
  if (!check.ok) throw new LedgerChainError(check);
  return createEvent(input, events.at(-1), sha256);
}

/** Same as appendEvent but returns a new array (input array untouched). */
export async function appendToChain(events, input, sha256 = webCryptoSha256Hex) {
  return [...events, await appendEvent(events, input, sha256)];
}

/**
 * Drop-in for the U3 web mock: append many inputs, return a new array, never mutate `chain`.
 * Verifies `chain` first (stricter than the mock) and throws LedgerChainError if it is already invalid.
 */
export async function append(chain, inputs, sha256 = webCryptoSha256Hex) {
  const check = await verifyChain(chain, sha256);
  if (!check.ok) throw new LedgerChainError(check);
  const next = [...chain];
  for (const input of inputs) next.push(await createEvent(input, next.at(-1), sha256));
  return next;
}

/** Builds a fresh chain from event inputs. */
export async function buildChain(inputs, sha256 = webCryptoSha256Hex) {
  return append([], inputs, sha256);
}

/** Events in display order: newest first by default (same helper as the U3 web mock). */
export function list(chain, order = "newest") {
  return order === "newest" ? [...chain].reverse() : [...chain];
}

export function headHash(events) {
  return events.length ? events[events.length - 1].hash : null;
}

/** Accepts "0x"-prefixed or mixed-case hex; returns 64 lowercase hex chars or null. */
export function normalizeHeadHash(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^0x/i, "").toLowerCase();
  return HEX64.test(s) ? s : null;
}

/** Parses pasted/loaded JSON: an array of events or `{ events: [...] }`. */
export function parseEventsJson(text) {
  const v = JSON.parse(text);
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray(v.events)) return v.events;
  throw new TypeError("expected a JSON array of events or { \"events\": [...] }");
}

/**
 * Full check used by the verify page: chain validity, then head vs anchor.
 * `anchor` is { headHash, count? } (count optional for a pasted head) or null.
 * Returns { ok, status, reason, index?, head?, anchorHead? }.
 */
export async function verifyAgainstAnchor(events, anchor, sha256 = webCryptoSha256Hex) {
  if (!Array.isArray(events) || events.length === 0) return { ok: false, status: "no-events", reason: "no events to verify" };
  const chain = await verifyChain(events, sha256);
  if (!chain.ok) {
    return { ok: false, status: "chain-invalid", index: chain.index, reason: `chain invalid at index ${chain.index}: ${chain.reason}` };
  }
  const head = headHash(events);
  if (!anchor) return { ok: false, status: "no-anchor", head, reason: "chain is internally valid, but there is no anchor to compare the head against" };
  const anchorHead = normalizeHeadHash(anchor.headHash);
  if (!anchorHead) return { ok: false, status: "bad-anchor", head, reason: `anchor head hash is not 64 hex chars: ${anchor.headHash}` };
  if (anchorHead !== head) {
    return { ok: false, status: "head-mismatch", head, anchorHead, reason: `head mismatch: expected ${head} (recomputed), anchor has ${anchorHead}` };
  }
  if (anchor.count !== undefined && anchor.count !== null && anchor.count !== events.length) {
    return { ok: false, status: "count-mismatch", head, anchorHead, reason: `count mismatch: ${events.length} events, anchor covers ${anchor.count}` };
  }
  return { ok: true, status: "verified", head, anchorHead, reason: `verified: ${events.length} events, head ${head} matches anchor` };
}

// ---- NEAR JSON-RPC view calls (read-only, no key) ----

function utf8ToBase64(text) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function buildViewRequest(contractId, methodName, args = {}) {
  return {
    jsonrpc: "2.0",
    id: "consent-guard",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: methodName,
      args_base64: utf8ToBase64(JSON.stringify(args)),
    },
  };
}

/** Decodes a `query/call_function` response body; the result is a byte array (or base64 string). */
export function decodeViewResponse(body) {
  if (body?.error) throw new Error(`RPC error: ${JSON.stringify(body.error.cause ?? body.error.data ?? body.error)}`);
  const r = body?.result;
  if (r?.error) throw new Error(`view error: ${r.error}`);
  let text;
  if (Array.isArray(r?.result)) text = new TextDecoder().decode(Uint8Array.from(r.result));
  else if (typeof r?.result === "string") text = base64ToUtf8(r.result);
  else throw new Error("unexpected RPC response: no result bytes");
  return text === "" ? null : JSON.parse(text);
}

/** Converts the contract's read_anchor value to { headHash, count, blockHeight, timestampMs } or null. */
export function normalizeAnchorView(value) {
  if (value === null || value === undefined) return null;
  const head = normalizeHeadHash(value.head_hash);
  if (!head) throw new Error(`read_anchor returned an invalid head_hash: ${value.head_hash}`);
  return { headHash: head, count: Number(value.count), blockHeight: Number(value.block_height), timestampMs: Number(value.timestamp_ms) };
}

/** POSTs read_anchor to a public RPC. Returns null when nothing is anchored yet. */
export async function fetchAnchor({ rpcUrl, contractId, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildViewRequest(contractId, "read_anchor")),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  return normalizeAnchorView(decodeViewResponse(await res.json()));
}
