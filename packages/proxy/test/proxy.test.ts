import { test } from "node:test";
import assert from "node:assert/strict";
import type { DataRequest, Grant } from "@consent-guard/policy";
import { createConsentProxy, type LlmAdapter, type LlmInput } from "../src/index.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);
const DAY = 24 * 60 * 60_000;

function spyAdapter(): LlmAdapter & { calls: LlmInput[] } {
  const calls: LlmInput[] = [];
  return {
    name: "spy",
    calls,
    async complete(input) {
      calls.push(structuredClone(input));
      return { text: `summary of ${input.data.length} rows`, recorded: false, source: "spy" };
    },
  };
}

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

const cardRows: Record<string, unknown>[] = [
  { merchant: "강남김밥", category: "식비", amount: 12000, account_number: "110-234-567890" },
  { merchant: "서울교통공사", category: "교통", amount: 1500, account_number: "110-234-567890" },
  { merchant: "한우명가", category: "식비", amount: 45000, account_number: "110-234-567890" },
];

const budgetReq = (id: string, extra: Partial<DataRequest> = {}): DataRequest => ({
  id,
  agentId: "budget-agent",
  dataset: "card_tx",
  fields: ["category", "amount", "merchant"],
  purpose: "budgeting",
  rangeDays: 90,
  at: NOW,
  ...extra,
});

test("allow: adapter receives only allowed fields, merchant masked", async () => {
  const adapter = spyAdapter();
  const proxy = createConsentProxy({ adapter });
  const res = await proxy.handle(budgetReq("r-allow"), [budgetGrant], cardRows, NOW);

  assert.equal(res.policy.decision, "allow");
  assert.equal(adapter.calls.length, 1);
  const input = adapter.calls[0]!;
  assert.deepEqual(input.data, [
    { category: "식비", amount: 12000, merchant: "***" },
    { category: "교통", amount: 1500, merchant: "***" },
    { category: "식비", amount: 45000, merchant: "***" },
  ]);
  assert.deepEqual(res.delivered, input.data);
  const allowed = new Set([...res.policy.passFields, ...res.policy.maskFields]);
  for (const row of input.data) for (const key of Object.keys(row)) assert.ok(allowed.has(key), key);

  const sent = JSON.stringify(input);
  for (const raw of ["강남김밥", "서울교통공사", "한우명가", "account_number", "110-234-567890"]) {
    assert.ok(!sent.includes(raw), `adapter input leaked ${raw}`);
  }
  assert.deepEqual(res.ai, { text: "summary of 3 rows", recorded: false, source: "spy", badge: "live" });
});

test("deny: raw account_number request never reaches the adapter", async () => {
  const adapter = spyAdapter();
  const proxy = createConsentProxy({ adapter });
  const req: DataRequest = {
    id: "r-account",
    agentId: "tax-agent",
    dataset: "bank_account",
    fields: ["account_number"],
    purpose: "tax_filing",
    at: NOW,
  };
  const res = await proxy.handle(req, [budgetGrant], [{ account_number: "110-234-567890" }], NOW);

  assert.equal(res.policy.decision, "deny");
  assert.deepEqual(res.delivered, []);
  assert.equal(res.ai, undefined);
  assert.equal(adapter.calls.length, 0);
});

test("pending: medical_record without grant never reaches the adapter", async () => {
  const adapter = spyAdapter();
  const proxy = createConsentProxy({ adapter });
  const req: DataRequest = {
    id: "r-medical",
    agentId: "health-agent",
    dataset: "medical_record",
    fields: ["allergy", "diagnosis"],
    purpose: "care_summary",
    at: NOW,
  };
  const rows = [{ allergy: ["땅콩"], diagnosis: "고혈압" }];
  const res = await proxy.handle(req, [budgetGrant], rows, NOW);

  assert.equal(res.policy.decision, "pending");
  assert.deepEqual(res.delivered, []);
  assert.equal(res.ai, undefined);
  assert.equal(adapter.calls.length, 0);
});

test("replay: same request id is denied and adapter is not called again", async () => {
  const adapter = spyAdapter();
  const proxy = createConsentProxy({ adapter });
  const first = await proxy.handle(budgetReq("r-replay"), [budgetGrant], cardRows, NOW);
  const second = await proxy.handle(budgetReq("r-replay"), [budgetGrant], cardRows, NOW);

  assert.equal(first.policy.decision, "allow");
  assert.equal(second.policy.decision, "deny");
  assert.deepEqual(second.delivered, []);
  assert.equal(second.ai, undefined);
  assert.equal(adapter.calls.length, 1);
});

test("maxRows: delivered and adapter data are sliced to req.maxRows", async () => {
  const adapter = spyAdapter();
  const proxy = createConsentProxy({ adapter });
  const res = await proxy.handle(budgetReq("r-rows", { maxRows: 2 }), [budgetGrant], cardRows, NOW);

  assert.equal(res.policy.decision, "allow");
  assert.equal(res.delivered.length, 2);
  assert.deepEqual(adapter.calls[0]!.data, [
    { category: "식비", amount: 12000, merchant: "***" },
    { category: "교통", amount: 1500, merchant: "***" },
  ]);
});
