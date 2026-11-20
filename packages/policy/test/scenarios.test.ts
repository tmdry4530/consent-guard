import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMask, evaluate, type DataRequest, type Grant } from "../src/index.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const budgetGrant: Grant = {
  id: "g-budget",
  agentId: "budget-agent",
  dataset: "card_tx",
  allowFields: ["category", "amount"],
  maskFields: ["merchant"],
  purposes: ["budgeting"],
  maxRangeDays: 90,
  expiresAt: NOW + 30 * DAY,
};

const dietGrant: Grant = {
  id: "g-diet",
  agentId: "diet-agent",
  dataset: "medical_record",
  allowFields: ["allergies"],
  maskFields: [],
  purposes: ["diet_recommendation"],
  expiresAt: NOW + 10 * MIN,
};

const dietReq = (id: string, at: number): DataRequest => ({
  id,
  agentId: "diet-agent",
  dataset: "medical_record",
  fields: ["allergies"],
  purpose: "diet_recommendation",
  at,
});

test("a) budget-agent reads card_tx with merchant masked", () => {
  const req: DataRequest = {
    id: "r-a",
    agentId: "budget-agent",
    dataset: "card_tx",
    fields: ["category", "amount", "merchant"],
    purpose: "budgeting",
    rangeDays: 90,
    at: NOW,
  };
  const r = evaluate(req, [budgetGrant], NOW);
  assert.equal(r.decision, "allow");
  assert.equal(r.grantId, "g-budget");
  assert.deepEqual(r.passFields, ["category", "amount"]);
  assert.deepEqual(r.maskFields, ["merchant"]);

  const rows = [
    { category: "food", amount: 12000, merchant: "Kimbap Heaven", card_number: "4111-1111" },
    { category: "transport", amount: 1400, merchant: "Seoul Metro", card_number: "4111-1111" },
  ];
  assert.deepEqual(applyMask(rows, r), [
    { category: "food", amount: 12000, merchant: "***" },
    { category: "transport", amount: 1400, merchant: "***" },
  ]);
});

test("b) budget-agent asking for account_number is denied", () => {
  const req: DataRequest = {
    id: "r-b",
    agentId: "budget-agent",
    dataset: "card_tx",
    fields: ["amount", "account_number"],
    purpose: "budgeting",
    at: NOW,
  };
  const r = evaluate(req, [budgetGrant], NOW);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /원문 금지.*account_number/);
  assert.deepEqual(r.passFields, []);
  assert.deepEqual(r.maskFields, []);
});

test("c) health-agent medical_record without grant is pending", () => {
  const req: DataRequest = {
    id: "r-c",
    agentId: "health-agent",
    dataset: "medical_record",
    fields: ["diagnosis"],
    purpose: "health_check",
    at: NOW,
  };
  const r = evaluate(req, [budgetGrant, dietGrant], NOW);
  assert.equal(r.decision, "pending");
  assert.match(r.reason, /승인/);
  assert.equal(r.grantId, undefined);
});

test("d) diet-agent allowed within TTL, denied once expired", () => {
  const ok = evaluate(dietReq("r-d1", NOW), [dietGrant], NOW);
  assert.equal(ok.decision, "allow");
  assert.equal(ok.grantId, "g-diet");
  assert.deepEqual(ok.passFields, ["allergies"]);
  assert.deepEqual(ok.maskFields, []);

  const later = NOW + 11 * MIN;
  const expired = evaluate(dietReq("r-d2", later), [dietGrant], later);
  assert.equal(expired.decision, "deny");
  assert.match(expired.reason, /만료/);
  assert.equal(expired.grantId, "g-diet");
});

test("e) diet-agent denied after the grant is revoked", () => {
  const revoked: Grant = { ...dietGrant, revokedAt: NOW + 1 * MIN };
  const at = NOW + 2 * MIN;
  const r = evaluate(dietReq("r-e", at), [revoked], at);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /철회/);
  assert.equal(r.grantId, "g-diet");
});
