import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyChain } from "@consent-guard/ledger/core";
import { EXPECTED_FINAL_COUNT, EXPECTED_FINAL_HEAD, mockAnchorView } from "../src/anchorConfig";
import { compareLive, type AnchorRead } from "../src/anchorStatus";
import { runDemoScenario } from "../src/demoScenario";

const onChain: AnchorRead = {
  kind: "read",
  anchor: { headHash: EXPECTED_FINAL_HEAD, count: EXPECTED_FINAL_COUNT, blockHeight: 278_539_285, timestampMs: 0 },
};

test("determinism: the full 5-scene demo always ends at the anchored head", async () => {
  const a = await runDemoScenario();
  const b = await runDemoScenario();
  assert.deepEqual(
    a.map((s) => s.ledger.map((e) => e.hash)),
    b.map((s) => s.ledger.map((e) => e.hash)),
  );
  const final = a.at(-1)!;
  assert.equal(final.after, 5);
  assert.equal(final.ledger.length, EXPECTED_FINAL_COUNT);
  assert.equal(final.ledger.at(-1)!.hash, EXPECTED_FINAL_HEAD);
  assert.deepEqual(await verifyChain(final.ledger), { ok: true });
});

test("scenario: badge is '앵커 전' through scenes 1–4 and '일치' only after scene 5", async () => {
  const snaps = await runDemoScenario();
  assert.deepEqual(
    snaps.map((s) => [s.after, s.ledger.length]),
    [["initial", 6], [3, 8], [4, 9], [5, 11]],
  );
  const kinds = snaps.map((s) => compareLive(onChain, { count: s.ledger.length, head: s.ledger.at(-1)?.hash, chainOk: true }).kind);
  assert.deepEqual(kinds, ["before", "before", "before", "match"]);
});

test("scenario: the steps produce the demo's story (approve, expire, revoke + denied re-request)", async () => {
  const final = (await runDemoScenario()).at(-1)!;
  const decision = (id: string) => final.state.requests.find((e) => e.request.id === id)?.result.decision;
  assert.equal(decision("req-medical-full"), "allow");
  assert.equal(decision("req-allergy-after-expire"), "deny");
  assert.equal(decision("req-card-after-revoke"), "deny");
  assert.ok(final.state.grants.find((g) => g.id === "grant-card-budget")?.revokedAt !== undefined);
  assert.deepEqual(
    final.ledger.map((e) => e.kind),
    ["grant", "grant", "access", "deny", "pending", "access", "grant", "access", "deny", "revoke", "deny"],
  );
});

test("mock: mockAnchorView() is the head/count the full demo actually ends at", async () => {
  const final = (await runDemoScenario()).at(-1)!.ledger;
  const view = mockAnchorView();
  assert.equal(final.length, view.count);
  assert.equal(final.at(-1)!.hash, view.headHash);
});
