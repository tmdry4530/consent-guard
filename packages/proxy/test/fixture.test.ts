import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DataRequest, Grant } from "@consent-guard/policy";
import { createConsentProxy, createFixtureAdapter, loadFixtureResponses } from "../src/index.ts";

const fixturesDir = new URL("../../../fixtures/", import.meta.url);
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, fixturesDir), "utf8"));

interface Demo {
  clock: { now: number };
  grants: Grant[];
  requests: DataRequest[];
}
// Repo-owned fixture files; shapes match the shared contract types.
const demo = readJson("demo.json") as Demo;
const sample = readJson("sample-data.json") as Record<string, Record<string, unknown>[]>;
const responses = loadFixtureResponses(readJson("ai-responses.json"));

function request(id: string): DataRequest {
  const req = demo.requests.find((r) => r.id === id);
  assert.ok(req, `demo request ${id} missing`);
  return req;
}

function fixtureText(id: string): string {
  const r = responses.find((x) => x.requestId === id);
  assert.ok(r, `ai fixture ${id} missing`);
  return r.text;
}

for (const { id, dataset } of [
  { id: "req-card-budget", dataset: "card_tx" },
  { id: "req-allergy-diet", dataset: "medical_record" },
]) {
  test(`${id}: allowed end-to-end and answered from the recorded fixture`, async () => {
    const proxy = createConsentProxy({ adapter: createFixtureAdapter(responses) });
    const rows = sample[dataset];
    assert.ok(rows, `sample data ${dataset} missing`);
    const res = await proxy.handle(request(id), demo.grants, rows, demo.clock.now);

    assert.equal(res.policy.decision, "allow", res.policy.reason);
    assert.ok(res.delivered.length > 0);
    assert.deepEqual(res.ai, { text: fixtureText(id), recorded: true, source: "fixture", badge: "recorded" });
  });
}

test("budget scenario delivers merchant masked", async () => {
  const proxy = createConsentProxy({ adapter: createFixtureAdapter(responses) });
  const res = await proxy.handle(request("req-card-budget"), demo.grants, sample.card_tx!, demo.clock.now);
  for (const row of res.delivered) assert.equal(row.merchant, "***");
});

test("fixture adapter throws for a request id without a recording", async () => {
  const adapter = createFixtureAdapter(responses);
  await assert.rejects(
    adapter.complete({ requestId: "req-unknown", agentId: "a", purpose: "p", data: [] }),
    /No recorded AI response for request id "req-unknown"/,
  );
});

test("loadFixtureResponses rejects malformed content", () => {
  assert.throws(() => loadFixtureResponses({}), /responses/);
  assert.throws(() => loadFixtureResponses({ responses: [{ requestId: "x" }] }), /text/);
  assert.throws(() => loadFixtureResponses({ responses: [{ requestId: "x", text: "t", recorded: "yes" }] }), /recorded/);
});
