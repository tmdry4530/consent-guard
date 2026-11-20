// Pure app state transitions. Each returns the next state plus the ledger inputs to append.
import type { DataRequest, Grant, PolicyResult } from "@consent-guard/policy";
import type { LedgerInput } from "@consent-guard/ledger/adapter";
import type { ProxyAiResult } from "@consent-guard/proxy";
import { evaluate } from "./policyAdapter";

export const APPROVED_GRANT_TTL_MS = 60 * 60 * 1000;

export interface RequestEntry {
  request: DataRequest;
  result: PolicyResult;
  /** Set when the user resolved a pending request from the approval queue. */
  resolvedBy?: "approve" | "reject";
  /** AI answer obtained through the consent proxy at the moment the request was allowed; kept as history. */
  ai?: ProxyAiResult;
  /** Set instead of `ai` when the proxy/adapter failed (e.g. no recorded answer for this id). */
  aiError?: string;
}

export interface AppState {
  requests: RequestEntry[];
  grants: Grant[];
  /**
   * Request ids the real policy engine has already evaluated (replay protection).
   * evaluate() mutates the set it is given, so transitions always pass a clone and store it.
   */
  seenRequestIds: ReadonlySet<string>;
}

export interface Transition {
  state: AppState;
  events: LedgerInput[];
}

function decisionEvent(req: DataRequest, result: PolicyResult, at: number): LedgerInput {
  const kind = result.decision === "allow" ? "access" : result.decision;
  const fields = result.decision === "allow" ? [...result.passFields, ...result.maskFields] : req.fields;
  return { kind, at, agentId: req.agentId, dataset: req.dataset, fields, refId: req.id };
}

function grantEvent(kind: "grant" | "revoke", g: Grant, at: number): LedgerInput {
  return { kind, at, agentId: g.agentId, dataset: g.dataset, fields: [...g.allowFields, ...g.maskFields], refId: g.id };
}

function updateEntry(state: AppState, id: string, entry: RequestEntry): AppState {
  return { ...state, requests: state.requests.map((e) => (e.request.id === id ? entry : e)) };
}

/**
 * Evaluate a new request. Feed-level dedupe: an id already in the feed is ignored (no second
 * row, no events). Any other id goes through the real engine's replay check via seenRequestIds.
 */
export function submitRequest(state: AppState, req: DataRequest, now: number): Transition {
  if (state.requests.some((e) => e.request.id === req.id)) return { state, events: [] };
  const seenRequestIds = new Set(state.seenRequestIds);
  const result = evaluate(req, state.grants, now, { seenRequestIds });
  return {
    state: { ...state, seenRequestIds, requests: [...state.requests, { request: req, result }] },
    events: [decisionEvent(req, result, now)],
  };
}

export function initialState(grants: Grant[], requests: DataRequest[], now: number): Transition {
  let state: AppState = { requests: [], grants, seenRequestIds: new Set() };
  const events: LedgerInput[] = grants.map((g) => grantEvent("grant", g, now));
  for (const req of requests) {
    const t = submitRequest(state, req, now);
    state = t.state;
    events.push(...t.events);
  }
  return { state, events };
}

function pendingEntry(state: AppState, requestId: string): RequestEntry | undefined {
  return state.requests.find((e) => e.request.id === requestId && e.result.decision === "pending");
}

/** User approves a pending request: create a 1h grant for exactly what was asked, then re-evaluate. */
export function approvePending(state: AppState, requestId: string, now: number): Transition {
  const entry = pendingEntry(state, requestId);
  if (!entry) return { state, events: [] };
  const req = entry.request;
  const grant: Grant = {
    id: `grant-${req.id}`,
    agentId: req.agentId,
    dataset: req.dataset,
    allowFields: [...req.fields],
    maskFields: [],
    purposes: [req.purpose],
    expiresAt: now + APPROVED_GRANT_TTL_MS,
    ...(req.rangeDays !== undefined && { maxRangeDays: req.rangeDays }),
    ...(req.maxRows !== undefined && { maxRows: req.maxRows }),
  };
  const grants = [...state.grants, grant];
  // The pending evaluation already burned req.id in the seen set. Owner approval after a
  // pending decision is a grant change, not a replay, so un-burn the id and re-evaluate the
  // same request against the new grants (evaluate re-adds the id).
  const seenRequestIds = new Set(state.seenRequestIds);
  seenRequestIds.delete(req.id);
  const result = evaluate(req, grants, now, { seenRequestIds });
  return {
    state: updateEntry({ ...state, grants, seenRequestIds }, req.id, { request: req, result, resolvedBy: "approve" }),
    events: [grantEvent("grant", grant, now), decisionEvent(req, result, now)],
  };
}

export function rejectPending(state: AppState, requestId: string, now: number): Transition {
  const entry = pendingEntry(state, requestId);
  if (!entry) return { state, events: [] };
  const result: PolicyResult = {
    decision: "deny",
    requestId,
    passFields: [],
    maskFields: [],
    reason: "사용자가 거부함",
  };
  return {
    state: updateEntry(state, requestId, { request: entry.request, result, resolvedBy: "reject" }),
    events: [decisionEvent(entry.request, result, now)],
  };
}

/** A grant can be revoked only while it is active: not already revoked and not past its TTL. */
export function canRevokeGrant(g: Grant, now: number): boolean {
  return g.revokedAt === undefined && g.expiresAt > now;
}

/**
 * Revoke an active grant (revokedAt = now); revoked or expired grants are a no-op. If `followUp`
 * is given (the agent's next request for the same data), it is enqueued at `now` and evaluated
 * against the updated grants.
 */
export function revokeGrant(state: AppState, grantId: string, now: number, followUp?: DataRequest): Transition {
  const target = state.grants.find((g) => g.id === grantId);
  if (!target || !canRevokeGrant(target, now)) return { state, events: [] };
  const revoked: Grant = { ...target, revokedAt: now };
  const next: AppState = { ...state, grants: state.grants.map((g) => (g.id === grantId ? revoked : g)) };
  const events = [grantEvent("revoke", revoked, now)];
  if (!followUp) return { state: next, events };
  const t = submitRequest(next, { ...followUp, at: now }, now);
  return { state: t.state, events: [...events, ...t.events] };
}

/**
 * The demo clock moved to `newNow`. Past decisions are history and are not rewritten. For every
 * non-revoked grant whose TTL has passed, its `afterExpire` follow-up (if any, and not already in
 * the feed) is enqueued at `newNow` and evaluated — the real policy denies it as expired.
 */
export function advanceDemoClock(state: AppState, newNow: number, afterExpire: Record<string, DataRequest>): Transition {
  let next = state;
  const events: LedgerInput[] = [];
  for (const g of state.grants) {
    const followUp = afterExpire[g.id];
    if (!followUp || g.revokedAt !== undefined || g.expiresAt > newNow) continue;
    const t = submitRequest(next, { ...followUp, at: newNow }, newNow);
    next = t.state;
    events.push(...t.events);
  }
  return { state: next, events };
}
