import { test } from "node:test";
import assert from "node:assert/strict";
import type { DataRequest, Grant } from "@consent-guard/policy";
import { NOW, TEN_MIN, loadDemo, sampleData } from "../src/fixtures";
import { MASK, applyMask, evaluate } from "../src/policyAdapter";

const demo = loadDemo();
const req = (id: string): DataRequest => {
  const r = demo.requests.find((x) => x.id === id);
  assert.ok(r, `fixture request ${id}`);
  return r;
};

test("1. card budget request auto-allowed with merchant masked", () => {
  const r = evaluate(req("req-card-budget"), demo.grants, NOW);
  assert.equal(r.decision, "allow");
  assert.equal(r.grantId, "grant-card-budget");
  assert.deepEqual([...r.passFields].sort(), ["amount", "category"]);
  assert.deepEqual(r.maskFields, ["merchant"]);
  assert.ok(!r.passFields.includes("merchant"));
});

test("2. raw account_number request denied", () => {
  const r = evaluate(req("req-account-raw"), demo.grants, NOW);
  assert.equal(r.decision, "deny");
  assert.deepEqual(r.passFields, []);
  assert.deepEqual(r.maskFields, []);
});

test("3. full medical record without grant is pending", () => {
  assert.equal(evaluate(req("req-medical-full"), demo.grants, NOW).decision, "pending");
});

test("4. allergy-only diet request within 10-min TTL allowed", () => {
  const r = evaluate(req("req-allergy-diet"), demo.grants, NOW + TEN_MIN - 1);
  assert.equal(r.decision, "allow");
  assert.deepEqual(r.passFields, ["allergy"]);
  assert.deepEqual(r.maskFields, []);
});

test("5. after revoking grant-card-budget the follow-up card request is denied", () => {
  const revoked: Grant[] = demo.grants.map((g) => (g.id === "grant-card-budget" ? { ...g, revokedAt: NOW + 1 } : g));
  const r = evaluate(demo.afterRevoke["grant-card-budget"], revoked, NOW + 2);
  assert.equal(r.decision, "deny");
  assert.deepEqual(r.passFields, []);
  assert.match(r.reason, /철회/);
});

test("diet grant expired at NOW+10min (TTL passed) → deny with expiry reason, even for medical_record", () => {
  const r = evaluate(req("req-allergy-diet"), demo.grants, NOW + TEN_MIN);
  assert.equal(r.decision, "deny");
  assert.equal(r.grantId, "grant-allergy-diet");
  assert.match(r.reason, /만료/);
});

test("purpose mismatch on non-sensitive dataset → deny", () => {
  const r = evaluate({ ...req("req-card-budget"), purpose: "marketing" }, demo.grants, NOW);
  assert.equal(r.decision, "deny");
});

test("range beyond grant maxRangeDays → deny", () => {
  assert.equal(evaluate({ ...req("req-card-budget"), rangeDays: 365 }, demo.grants, NOW).decision, "deny");
});

test("field outside allow ∪ mask → deny (diagnosis on diet grant)", () => {
  const r = evaluate({ ...req("req-allergy-diet"), fields: ["allergy", "diagnosis"] }, demo.grants, NOW);
  assert.equal(r.decision, "deny");
  assert.deepEqual(r.passFields, []);
});

test("replay via seenRequestIds: second evaluate of the same id is denied", () => {
  const seenRequestIds = new Set<string>();
  assert.equal(evaluate(req("req-card-budget"), demo.grants, NOW, { seenRequestIds }).decision, "allow");
  const replay = evaluate(req("req-card-budget"), demo.grants, NOW, { seenRequestIds });
  assert.equal(replay.decision, "deny");
  assert.match(replay.reason, /재요청/);
});

test("applyMask on card_tx rows with the card-budget allow result → merchant masked, category/amount kept", () => {
  const result = evaluate(req("req-card-budget"), demo.grants, NOW);
  const rows = applyMask(sampleData.card_tx, result);
  assert.equal(rows.length, sampleData.card_tx.length);
  rows.forEach((row, i) => {
    assert.equal(row.merchant, MASK);
    assert.equal(row.category, sampleData.card_tx[i].category);
    assert.equal(row.amount, sampleData.card_tx[i].amount);
  });
});
