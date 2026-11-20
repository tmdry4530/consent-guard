import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPolicyEngine,
  evaluate,
  FORBIDDEN_RAW_FIELDS,
  SENSITIVE_DATASETS,
  type DataRequest,
  type Grant,
} from "../src/index.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);
const HOUR = 3_600_000;

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "g1",
  agentId: "budget-agent",
  dataset: "card_tx",
  allowFields: ["category", "amount"],
  maskFields: ["merchant"],
  purposes: ["budgeting"],
  maxRangeDays: 90,
  maxRows: 500,
  expiresAt: NOW + HOUR,
  ...over,
});

const request = (over: Partial<DataRequest> = {}): DataRequest => ({
  id: "r1",
  agentId: "budget-agent",
  dataset: "card_tx",
  fields: ["category", "amount", "merchant"],
  purpose: "budgeting",
  rangeDays: 30,
  maxRows: 100,
  at: NOW,
  ...over,
});

test("constants", () => {
  assert.deepEqual([...SENSITIVE_DATASETS], ["medical_record", "location"]);
  for (const f of ["account_number", "card_number", "resident_id"]) assert.ok(FORBIDDEN_RAW_FIELDS.includes(f));
});

test("replay via createPolicyEngine: same id is denied the second time", () => {
  const engine = createPolicyEngine();
  assert.equal(engine.evaluate(request(), [grant()], NOW).decision, "allow");
  const again = engine.evaluate(request(), [grant()], NOW);
  assert.equal(again.decision, "deny");
  assert.match(again.reason, /replay/);
  assert.equal(engine.evaluate(request({ id: "r2" }), [grant()], NOW).decision, "allow");
  // engines do not share state
  assert.equal(createPolicyEngine().evaluate(request(), [grant()], NOW).decision, "allow");
});

test("replay via seenRequestIds: checks, then records the id", () => {
  const seen = new Set<string>();
  assert.equal(evaluate(request(), [grant()], NOW, { seenRequestIds: seen }).decision, "allow");
  assert.ok(seen.has("r1"));
  assert.equal(evaluate(request(), [grant()], NOW, { seenRequestIds: seen }).decision, "deny");
  // a denied request id is also burned
  const bad = request({ id: "r9", fields: ["card_number"] });
  evaluate(bad, [grant()], NOW, { seenRequestIds: seen });
  assert.match(evaluate(request({ id: "r9" }), [grant()], NOW, { seenRequestIds: seen }).reason, /replay/);
  // without opts evaluate is pure
  assert.equal(evaluate(request(), [grant()], NOW).decision, "allow");
});

test("forbidden raw field is denied even if the grant allows it", () => {
  const g = grant({ allowFields: ["category", "amount", "card_number"] });
  const r = evaluate(request({ fields: ["amount", "card_number"] }), [g], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /card_number/);
  assert.equal(r.grantId, undefined);
});

test("forbidden field beats missing grant on a sensitive dataset", () => {
  const r = evaluate(request({ dataset: "location", fields: ["resident_id"] }), [], NOW);
  assert.equal(r.decision, "deny");
});

test("grants for another agent or dataset are ignored", () => {
  const r = evaluate(request(), [grant({ agentId: "other" }), grant({ dataset: "bank_tx" })], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /No grant/);
});

test("revoked takes precedence over expired", () => {
  const g = grant({ revokedAt: NOW - 2 * HOUR, expiresAt: NOW - HOUR });
  const r = evaluate(request(), [g], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /revoked/);
  assert.equal(r.grantId, "g1");
});

test("revocation in the future is not yet effective; revokedAt == now is", () => {
  assert.equal(evaluate(request(), [grant({ revokedAt: NOW + 1 })], NOW).decision, "allow");
  assert.match(evaluate(request(), [grant({ revokedAt: NOW })], NOW).reason, /revoked/);
});

test("one live grant survives a revoked sibling", () => {
  const r = evaluate(request(), [grant({ id: "old", revokedAt: NOW - 1 }), grant({ id: "new" })], NOW);
  assert.equal(r.decision, "allow");
  assert.equal(r.grantId, "new");
});

test("expired: expiresAt == now counts as expired", () => {
  const r = evaluate(request(), [grant({ expiresAt: NOW })], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /expired/);
  assert.equal(r.grantId, "g1");
});

test("revoked + expired mix where none is revoked-only reports expired", () => {
  const r = evaluate(request(), [grant({ id: "a", revokedAt: NOW - 1 }), grant({ id: "b", expiresAt: NOW - 1 })], NOW);
  assert.match(r.reason, /expired/);
  assert.equal(r.grantId, "b");
});

test("location is sensitive: pending without a grant", () => {
  const r = evaluate(request({ agentId: "map-agent", dataset: "location", fields: ["lat", "lng"], purpose: "commute" }), [], NOW);
  assert.equal(r.decision, "pending");
  assert.deepEqual(r.passFields, []);
  assert.deepEqual(r.maskFields, []);
});

test("non-sensitive dataset without a grant is denied", () => {
  const r = evaluate(request(), [], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /No grant/);
});

test("purpose mismatch is denied", () => {
  const r = evaluate(request({ purpose: "marketing" }), [grant()], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /Purpose "marketing"/);
  assert.equal(r.grantId, "g1");
});

test("purpose picks the matching grant among several", () => {
  const r = evaluate(request({ purpose: "tax" }), [grant(), grant({ id: "g2", purposes: ["tax"] })], NOW);
  assert.equal(r.decision, "allow");
  assert.equal(r.grantId, "g2");
});

test("rangeDays over limit is denied; equal passes", () => {
  const r = evaluate(request({ rangeDays: 91 }), [grant()], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /range of 91 days.*90 days/);
  assert.equal(evaluate(request({ rangeDays: 90 }), [grant()], NOW).decision, "allow");
});

test("maxRows over limit is denied; equal passes", () => {
  const r = evaluate(request({ maxRows: 501 }), [grant()], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /501 rows.*500 rows/);
  assert.equal(evaluate(request({ maxRows: 500 }), [grant()], NOW).decision, "allow");
});

test("limits absent on the grant are not enforced", () => {
  const g = grant({ maxRangeDays: undefined, maxRows: undefined });
  assert.equal(evaluate(request({ rangeDays: 3650, maxRows: 1e6 }), [g], NOW).decision, "allow");
});

test("unknown field is denied and listed", () => {
  const r = evaluate(request({ fields: ["amount", "card_holder", "memo"] }), [grant()], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /card_holder, memo/);
  assert.deepEqual(r.passFields, []);
  assert.equal(r.grantId, "g1");
});

test("field in both allow and mask lists is masked, not passed", () => {
  const g = grant({ allowFields: ["category", "amount", "merchant"] });
  const r = evaluate(request(), [g], NOW);
  assert.deepEqual(r.passFields, ["category", "amount"]);
  assert.deepEqual(r.maskFields, ["merchant"]);
});

test("allow returns only requested fields", () => {
  const r = evaluate(request({ fields: ["amount"] }), [grant()], NOW);
  assert.equal(r.decision, "allow");
  assert.deepEqual(r.passFields, ["amount"]);
  assert.deepEqual(r.maskFields, []);
  assert.equal(r.requestId, "r1");
});
