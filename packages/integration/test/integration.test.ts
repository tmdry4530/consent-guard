import { test } from "node:test";
import assert from "node:assert/strict";
import type { LedgerEvent } from "@consent-guard/policy";
import type { LlmAdapter, LlmInput } from "@consent-guard/proxy";
import { verifyChain } from "@consent-guard/ledger/core";
import type { VerifyResult } from "@consent-guard/ledger/core";
import { createDemoPipeline } from "../src/pipeline.ts";
import { createDemoAdapter, runScenes, sampleData, SCENE_START } from "../src/scenarios.ts";
import { main } from "../scripts/demo-cli.ts";

function spyAdapter(inner: LlmAdapter): LlmAdapter & { calls: LlmInput[] } {
  const calls: LlmInput[] = [];
  return {
    name: `spy(${inner.name})`,
    calls,
    complete(input) {
      calls.push(structuredClone(input));
      return inner.complete(input);
    },
  };
}

async function runDemo() {
  const adapter = spyAdapter(createDemoAdapter());
  const pipeline = createDemoPipeline({ adapter, now: SCENE_START });
  let callsAtRevoke = -1;
  const runs = await runScenes(pipeline, {
    onStep(_scene, outcome) {
      if (outcome.op === "revoke") callsAtRevoke = adapter.calls.length;
    },
  });
  return { adapter, pipeline, runs, callsAtRevoke };
}

const demo = await runDemo();
const requests = demo.runs.flatMap((run) => run.outcomes.flatMap((o) => (o.op === "request" ? [o] : [])));

test("decisions per scene", () => {
  assert.deepEqual(
    demo.runs.map((run) => run.outcomes.flatMap((o) => (o.op === "request" ? [o.result.policy.decision] : []))),
    [["allow"], ["deny"], ["pending"], ["allow", "deny"], ["deny"]],
  );
  for (const o of requests) assert.equal(o.result.policy.decision, o.expect, o.request.id);
  const expired = requests.find((o) => o.request.id === "req-allergy-diet-expired");
  assert.match(expired!.result.policy.reason, /만료/);
  const revoked = requests.find((o) => o.request.id === "req-card-after-revoke");
  assert.match(revoked!.result.policy.reason, /철회/);
});

test("raw merchant and account_number never leave the proxy", () => {
  const merchants = sampleData.card_tx!.map((row) => String(row.merchant));
  const outbound = [...demo.adapter.calls.map((c) => c.data), ...requests.map((o) => o.result.delivered)];
  const text = JSON.stringify(outbound);
  for (const m of merchants) assert.ok(!text.includes(m), `raw merchant ${m} leaked`);
  assert.ok(!text.includes("account_number"));

  const card = requests.find((o) => o.request.id === "req-card-budget")!;
  assert.equal(card.result.delivered.length, merchants.length);
  for (const row of card.result.delivered) assert.equal(row.merchant, "***");
  assert.equal(card.result.ai?.badge, "recorded");
});

test("adapter is called exactly once per allow, and not after revoke", () => {
  const allows = requests.filter((o) => o.result.policy.decision === "allow").length;
  assert.equal(allows, 2);
  assert.equal(demo.adapter.calls.length, allows);
  assert.deepEqual(
    demo.adapter.calls.map((c) => c.requestId),
    ["req-card-budget", "req-allergy-diet"],
  );
  assert.equal(demo.callsAtRevoke, demo.adapter.calls.length, "re-request after revoke reached the adapter");
});

test("ledger records every step in order and verifies", async () => {
  const chain = demo.pipeline.getChain();
  assert.deepEqual(
    chain.map((e) => [e.seq, e.kind, e.refId]),
    [
      [1, "grant", "grant-card-budget"],
      [2, "access", "req-card-budget"],
      [3, "deny", "req-account-raw"],
      [4, "pending", "req-medical-full"],
      [5, "grant", "grant-allergy-diet"],
      [6, "access", "req-allergy-diet"],
      [7, "deny", "req-allergy-diet-expired"],
      [8, "revoke", "grant-card-budget"],
      [9, "deny", "req-card-after-revoke"],
    ],
  );
  assert.deepEqual(chain[1]!.fields, ["category", "amount", "merchant"]);
  assert.deepEqual(chain[2]!.fields, ["account_number"]);
  assert.equal(chain[6]!.at - chain[5]!.at, 11 * 60_000);
  assert.deepEqual(await demo.pipeline.verify(), { ok: true });
});

test("tampering with a copy of the chain is detected at the right index", async () => {
  const copy = (): LedgerEvent[] => structuredClone(demo.pipeline.getChain());

  const editedFields = copy();
  editedFields[1]!.fields = ["category", "amount"];
  assert.deepEqual(pick(await verifyChain(editedFields)), { ok: false, index: 1 });

  const editedAgent = copy();
  editedAgent[5]!.agentId = "budget-agent";
  assert.deepEqual(pick(await verifyChain(editedAgent)), { ok: false, index: 5 });

  const deleted = copy();
  deleted.splice(2, 1);
  assert.deepEqual(pick(await verifyChain(deleted)), { ok: false, index: 2 });

  const reordered = copy();
  [reordered[3], reordered[4]] = [reordered[4]!, reordered[3]!];
  assert.deepEqual(pick(await verifyChain(reordered)), { ok: false, index: 3 });

  assert.deepEqual(await demo.pipeline.verify(), { ok: true }, "pipeline chain must be unaffected by copies");
});

function pick(r: VerifyResult): { ok: boolean; index?: number } {
  return r.ok ? { ok: true } : { ok: false, index: r.index };
}

test("demo CLI main prints the scenes and ends with chain verified: OK", async () => {
  const lines: string[] = [];
  const adapter = spyAdapter(createDemoAdapter());
  const result = await main((line) => lines.push(line), adapter);
  assert.equal(lines.at(-1), "chain verified: OK");
  assert.ok(result.verify.ok);
  assert.equal(result.chain.length, 9);
  assert.equal(adapter.calls.length, 2);
  const out = lines.join("\n");
  assert.match(out, /\[recorded\]/);
  assert.match(out, /"merchant":"\*\*\*"/);
  for (const row of sampleData.card_tx!) assert.ok(!out.includes(String(row.merchant)));
});
