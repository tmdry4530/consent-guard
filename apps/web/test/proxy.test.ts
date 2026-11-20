import { test } from "node:test";
import assert from "node:assert/strict";
import { createFixtureAdapter, type LlmAdapter, type LlmInput } from "@consent-guard/proxy";
import { awaitingAi, createAppProxy, fetchAi, withAi } from "../src/ai";
import { NOW, TEN_MIN, aiFixtures, loadDemo } from "../src/fixtures";
import { MASK } from "../src/policyAdapter";
import { advanceDemoClock, approvePending, initialState, revokeGrant, type AppState } from "../src/state";

function spyAdapter(): LlmAdapter & { calls: LlmInput[] } {
  const inner = createFixtureAdapter(aiFixtures);
  const calls: LlmInput[] = [];
  return { name: "spy", calls, complete: (input) => (calls.push(input), inner.complete(input)) };
}

/** What the app does after every transition: proxy only the newly allowed entries, at decision time. */
async function attach(proxy: ReturnType<typeof createAppProxy>, state: AppState, now: number): Promise<AppState> {
  return withAi(state, await fetchAi(proxy, state, awaitingAi(state), now));
}

test("AI goes through the proxy only for allows; deny/pending/revoke/expire never reach the adapter", async () => {
  const demo = loadDemo();
  const adapter = spyAdapter();
  const proxy = createAppProxy(adapter);
  const ai = (s: AppState, id: string) => s.requests.find((e) => e.request.id === id)?.ai;

  // Initial four: card allow, account deny, medical pending, diet allow.
  let state = await attach(proxy, initialState(demo.grants, demo.requests, NOW).state, NOW);
  assert.deepEqual(adapter.calls.map((c) => c.requestId).sort(), ["req-allergy-diet", "req-card-budget"]);
  assert.equal(ai(state, "req-card-budget")?.badge, "recorded");
  assert.equal(ai(state, "req-account-raw"), undefined);
  assert.equal(ai(state, "req-medical-full"), undefined);
  // Merchant is masked in what the model receives.
  const card = adapter.calls.find((c) => c.requestId === "req-card-budget")!;
  assert.ok(card.data.length > 0 && card.data.every((row) => row.merchant === MASK));

  // Approve medical: one more call, recorded badge (no replay-deny from a second seen set).
  const approveAt = NOW + 1000;
  state = await attach(proxy, approvePending(state, "req-medical-full", approveAt).state, approveAt);
  assert.equal(adapter.calls.length, 3);
  assert.equal(ai(state, "req-medical-full")?.badge, "recorded");

  // Expire the diet grant, then revoke card: follow-ups are denied, adapter untouched, history kept.
  const later = NOW + TEN_MIN;
  state = await attach(proxy, advanceDemoClock(state, later, demo.afterExpire).state, later);
  state = await attach(proxy, revokeGrant(state, "grant-card-budget", later, demo.afterRevoke["grant-card-budget"]).state, later);
  for (const id of ["req-allergy-after-expire", "req-card-after-revoke"]) {
    const entry = state.requests.find((e) => e.request.id === id)!;
    assert.equal(entry.result.decision, "deny");
    // Even calling handle directly short-circuits on deny.
    const r = await proxy.handle(entry.request, state.grants, [], later);
    assert.equal(r.policy.decision, "deny");
    assert.equal(r.ai, undefined);
  }
  assert.equal(adapter.calls.length, 3);
  assert.equal(ai(state, "req-allergy-diet")?.badge, "recorded");
  assert.equal(ai(state, "req-card-budget")?.badge, "recorded");
});
