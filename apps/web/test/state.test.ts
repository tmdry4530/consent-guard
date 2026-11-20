import { test } from "node:test";
import assert from "node:assert/strict";
import { NOW, loadDemo } from "../src/fixtures";
import { approvePending, initialState, rejectPending, revokeGrant, submitRequest } from "../src/state";

const demo = loadDemo();
const decisionOf = (s: ReturnType<typeof initialState>["state"], id: string) =>
  s.requests.find((e) => e.request.id === id)?.result.decision;

test("initial load seeds grant events first, then one decision event per request", () => {
  const { state, events } = initialState(demo.grants, demo.requests, NOW);
  assert.deepEqual(events.map((e) => e.kind), ["grant", "grant", "access", "deny", "pending", "access"]);
  assert.deepEqual(events[2].fields, ["category", "amount", "merchant"]);
  assert.equal(decisionOf(state, "req-medical-full"), "pending");
});

test("replay: resubmitting a decided request id is ignored", () => {
  const { state } = initialState(demo.grants, demo.requests, NOW);
  const t = submitRequest(state, demo.requests[0], NOW + 1);
  assert.equal(t.state, state);
  assert.deepEqual(t.events, []);
});

test("approve pending medical → 1h grant + allow with all requested fields", () => {
  const { state } = initialState(demo.grants, demo.requests, NOW);
  const t = approvePending(state, "req-medical-full", NOW + 1000);
  assert.deepEqual(t.events.map((e) => e.kind), ["grant", "access"]);
  const entry = t.state.requests.find((e) => e.request.id === "req-medical-full");
  assert.equal(entry?.result.decision, "allow");
  assert.deepEqual(entry?.result.passFields, ["allergy", "diagnosis", "notes"]);
  const g = t.state.grants.find((x) => x.id === "grant-req-medical-full");
  assert.equal(g?.expiresAt, NOW + 1000 + 60 * 60 * 1000);
});

test("reject pending → deny without a grant", () => {
  const { state } = initialState(demo.grants, demo.requests, NOW);
  const t = rejectPending(state, "req-medical-full", NOW + 1000);
  assert.equal(decisionOf(t.state, "req-medical-full"), "deny");
  assert.equal(t.state.grants.length, state.grants.length);
  assert.deepEqual(t.events.map((e) => e.kind), ["deny"]);
});

test("revoke card grant enqueues follow-up request that is denied; second revoke is a no-op", () => {
  const { state } = initialState(demo.grants, demo.requests, NOW);
  const t = revokeGrant(state, "grant-card-budget", NOW + 5000, demo.afterRevoke["grant-card-budget"]);
  assert.deepEqual(t.events.map((e) => e.kind), ["revoke", "deny"]);
  assert.equal(decisionOf(t.state, "req-card-after-revoke"), "deny");
  assert.equal(t.state.requests.find((e) => e.request.id === "req-card-after-revoke")?.request.at, NOW + 5000);
  const again = revokeGrant(t.state, "grant-card-budget", NOW + 6000, demo.afterRevoke["grant-card-budget"]);
  assert.equal(again.state, t.state);
});
