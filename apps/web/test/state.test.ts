import { test } from "node:test";
import assert from "node:assert/strict";
import { NOW, TEN_MIN, loadDemo } from "../src/fixtures";
import { evaluate } from "../src/policyAdapter";
import { advanceDemoClock, approvePending, canRevokeGrant, initialState, rejectPending, revokeGrant, submitRequest } from "../src/state";

const demo = loadDemo();
const decisionOf = (s: ReturnType<typeof initialState>["state"], id: string) =>
  s.requests.find((e) => e.request.id === id)?.result.decision;

test("initial load seeds grant events first, then one decision event per request", () => {
  const { state, events } = initialState(demo.grants, demo.requests, NOW);
  assert.deepEqual(events.map((e) => e.kind), ["grant", "grant", "access", "deny", "pending", "access"]);
  assert.deepEqual(events[2].fields, ["category", "amount", "merchant"]);
  assert.equal(decisionOf(state, "req-medical-full"), "pending");
  assert.deepEqual([...state.seenRequestIds], demo.requests.map((r) => r.id));
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
  assert.ok(t.state.seenRequestIds.has("req-medical-full"));
  // The previous state's seen set was not mutated.
  assert.notEqual(t.state.seenRequestIds, state.seenRequestIds);
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

test("advancing the clock by 10 min expires the diet grant and denies its follow-up exactly once", () => {
  const { state } = initialState(demo.grants, demo.requests, NOW);
  const later = NOW + TEN_MIN;

  // Before TTL: nothing to enqueue.
  assert.equal(advanceDemoClock(state, later - 1, demo.afterExpire).state, state);

  const t = advanceDemoClock(state, later, demo.afterExpire);
  const diet = t.state.grants.find((g) => g.id === "grant-allergy-diet");
  assert.ok(diet && diet.revokedAt === undefined && diet.expiresAt <= later);
  assert.deepEqual(t.events.map((e) => [e.kind, e.refId]), [["deny", "req-allergy-after-expire"]]);
  const followUp = t.state.requests.find((e) => e.request.id === "req-allergy-after-expire");
  assert.equal(followUp?.result.decision, "deny");
  assert.equal(followUp?.request.at, later);
  assert.match(followUp?.result.reason ?? "", /grant-allergy-diet.*expired/);
  // History is not rewritten.
  assert.equal(decisionOf(t.state, "req-allergy-diet"), "allow");

  const again = advanceDemoClock(t.state, later + TEN_MIN, demo.afterExpire);
  assert.equal(again.state, t.state);
  assert.deepEqual(again.events, []);
  assert.equal(again.state.requests.filter((e) => e.request.id === "req-allergy-after-expire").length, 1);
});

test("direct evaluate of the after-expire follow-up at NOW+10min is deny", () => {
  const r = evaluate(demo.afterExpire["grant-allergy-diet"], demo.grants, NOW + TEN_MIN);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /expired/);
});

test("revoke action is offered only for active grants; expired diet grant after +10 min is not revocable", () => {
  const { state } = initialState(demo.grants, demo.requests, NOW);
  const grant = (s: typeof state, id: string) => s.grants.find((g) => g.id === id)!;
  assert.equal(canRevokeGrant(grant(state, "grant-card-budget"), NOW), true);
  assert.equal(canRevokeGrant(grant(state, "grant-allergy-diet"), NOW), true);

  const later = NOW + TEN_MIN;
  const t = advanceDemoClock(state, later, demo.afterExpire);
  assert.equal(canRevokeGrant(grant(t.state, "grant-allergy-diet"), later), false);
  assert.equal(canRevokeGrant(grant(t.state, "grant-card-budget"), later), true);
  // Safety net: revoking the expired grant is a no-op.
  const r = revokeGrant(t.state, "grant-allergy-diet", later, demo.afterRevoke["grant-allergy-diet"]);
  assert.equal(r.state, t.state);
  assert.deepEqual(r.events, []);
  // Card grant still revokes normally.
  const rc = revokeGrant(t.state, "grant-card-budget", later, demo.afterRevoke["grant-card-budget"]);
  assert.equal(canRevokeGrant(grant(rc.state, "grant-card-budget"), later), false);
});
