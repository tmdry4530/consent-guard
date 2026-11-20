// Pure app state transitions. Each returns the next state plus the ledger inputs to append.
import type { DataRequest, Grant, PolicyResult } from "../../../packages/policy/src/types";
import type { LedgerInput } from "./ledgerAdapter";
import { evaluate } from "./policyAdapter";

export const APPROVED_GRANT_TTL_MS = 60 * 60 * 1000;

export interface RequestEntry {
  request: DataRequest;
  result: PolicyResult;
  /** Set when the user resolved a pending request from the approval queue. */
  resolvedBy?: "approve" | "reject";
}

export interface AppState {
  requests: RequestEntry[];
  grants: Grant[];
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

/** Replay protection: a request id that was already decided is ignored (no new evaluation, no events). */
export function submitRequest(state: AppState, req: DataRequest, now: number): Transition {
  if (state.requests.some((e) => e.request.id === req.id)) return { state, events: [] };
  const result = evaluate(req, state.grants, now);
  return {
    state: { ...state, requests: [...state.requests, { request: req, result }] },
    events: [decisionEvent(req, result, now)],
  };
}

export function initialState(grants: Grant[], requests: DataRequest[], now: number): Transition {
  let state: AppState = { requests: [], grants };
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
  // Re-evaluation of an already-decided id is allowed here because the grant set changed.
  const result = evaluate(req, grants, now);
  return {
    state: updateEntry({ ...state, grants }, req.id, { request: req, result, resolvedBy: "approve" }),
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

/**
 * Revoke a grant (revokedAt = now). If `followUp` is given (the agent's next request for
 * the same data), it is enqueued at `now` and evaluated against the updated grants.
 */
export function revokeGrant(state: AppState, grantId: string, now: number, followUp?: DataRequest): Transition {
  const target = state.grants.find((g) => g.id === grantId);
  if (!target || target.revokedAt !== undefined) return { state, events: [] };
  const revoked: Grant = { ...target, revokedAt: now };
  const next: AppState = { ...state, grants: state.grants.map((g) => (g.id === grantId ? revoked : g)) };
  const events = [grantEvent("revoke", revoked, now)];
  if (!followUp) return { state: next, events };
  const t = submitRequest(next, { ...followUp, at: now }, now);
  return { state: t.state, events: [...events, ...t.events] };
}
