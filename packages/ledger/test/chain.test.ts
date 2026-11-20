import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GENESIS_PREV_HASH,
  LedgerChainError,
  appendEvent,
  appendToChain,
  computeEventHash,
  parseEventsJson,
  verifyAgainstAnchor,
  verifyChain,
  type LedgerEvent,
  type LedgerEventInput,
} from "../src/core.js";
import { nodeSha256Hex, node } from "../src/index.ts";

const T = 1_795_165_200_000;
const inputs: LedgerEventInput[] = [
  { kind: "grant", at: T, agentId: "budget-agent", dataset: "card_tx", fields: ["category", "amount"], refId: "g1" },
  { kind: "access", at: T + 1, agentId: "budget-agent", dataset: "card_tx", fields: ["category"], refId: "r1" },
  { kind: "deny", at: T + 2, agentId: "diet-agent", dataset: "medical_record", fields: ["diagnosis"], refId: "r2" },
  { kind: "pending", at: T + 3, agentId: "travel-agent", dataset: "location", fields: ["city"], refId: "r3" },
  { kind: "revoke", at: T + 4, agentId: "budget-agent", dataset: "card_tx", fields: [], refId: "g1" },
];
const chain = await node.buildChain(inputs);
const clone = (): LedgerEvent[] => structuredClone(chain);
const at = (events: LedgerEvent[], i: number): LedgerEvent => {
  const e = events[i];
  assert.ok(e);
  return e;
};

test("empty chain is valid", async () => {
  assert.deepEqual(await verifyChain([]), { ok: true });
});

test("build: genesis, links, sequential seq, verify ok", async () => {
  assert.equal(chain.length, 5);
  assert.equal(at(chain, 0).seq, 1);
  assert.equal(at(chain, 0).prevHash, GENESIS_PREV_HASH);
  for (let i = 1; i < chain.length; i++) {
    assert.equal(at(chain, i).seq, i + 1);
    assert.equal(at(chain, i).prevHash, at(chain, i - 1).hash);
  }
  assert.deepEqual(await node.verifyChain(chain), { ok: true });
  assert.deepEqual(await verifyChain(chain), { ok: true }); // WebCrypto default
});

test("append does not mutate input; appendToChain returns a new array", async () => {
  const before = clone();
  const input: LedgerEventInput = { kind: "access", at: T + 9, agentId: "x", dataset: "card_tx", fields: ["amount"], refId: "r9" };
  const next = await appendEvent(before, input, nodeSha256Hex);
  assert.equal(before.length, 5);
  assert.deepEqual(before, chain);
  assert.equal(next.seq, 6);
  assert.equal(next.prevHash, at(chain, 4).hash);
  assert.equal(next.hash, await computeEventHash(next, nodeSha256Hex));
  const longer = await appendToChain(before, input, nodeSha256Hex);
  assert.notEqual(longer, before);
  assert.deepEqual(longer.at(-1), next);
  assert.deepEqual(await node.verifyChain(longer), { ok: true });
});

test("append refuses an already-invalid chain", async () => {
  const bad = clone();
  at(bad, 2).refId = "tampered";
  await assert.rejects(
    appendEvent(bad, inputs[0]!, nodeSha256Hex),
    (e: unknown) => e instanceof LedgerChainError && e.index === 2,
  );
});

test("anchorTx can be filled in later without breaking the chain", async () => {
  const anchored = clone();
  at(anchored, 4).anchorTx = "5GKh9fQHgsQ9HmuWzDF3ckvXTKxbdDXP175kxZp2RZpg";
  assert.deepEqual(await node.verifyChain(anchored), { ok: true });
});

test("tamper: field edit fails at the edited index", async () => {
  for (const mutate of [
    (e: LedgerEvent) => { e.fields = [...e.fields, "merchant"]; },
    (e: LedgerEvent) => { e.kind = "access"; },
    (e: LedgerEvent) => { e.at += 1; },
  ]) {
    const t = clone();
    mutate(at(t, 2));
    const r = await node.verifyChain(t);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.index === 2 && r.reason.startsWith("hash mismatch"), JSON.stringify(r));
  }
});

test("tamper: edit + recomputed hash still breaks the next link", async () => {
  const t = clone();
  const e = at(t, 1);
  e.fields = ["category", "amount", "merchant"];
  e.hash = await computeEventHash(e, nodeSha256Hex);
  const r = await node.verifyChain(t);
  assert.ok(!r.ok && r.index === 2 && r.reason.startsWith("prevHash mismatch"), JSON.stringify(r));
});

test("tamper: reorder fails at the first moved position", async () => {
  const t = clone();
  [t[1], t[3]] = [at(t, 3), at(t, 1)];
  const r = await node.verifyChain(t);
  assert.ok(!r.ok && r.index === 1 && r.reason.startsWith("seq mismatch"), JSON.stringify(r));
});

test("tamper: deletion fails where the deleted event was", async () => {
  const t = clone();
  t.splice(2, 1);
  const r = await node.verifyChain(t);
  assert.ok(!r.ok && r.index === 2 && r.reason === "seq mismatch: expected 3, got 4", JSON.stringify(r));
  // deleting the genesis event
  const g = clone().slice(1);
  const rg = await node.verifyChain(g);
  assert.ok(!rg.ok && rg.index === 0, JSON.stringify(rg));
});

test("tamper: deleting the tail is not detectable by the chain alone, only by the anchor", async () => {
  const t = clone().slice(0, 4);
  assert.deepEqual(await node.verifyChain(t), { ok: true });
  const r = await verifyAgainstAnchor(t, { headHash: at(chain, 4).hash, count: 5 }, nodeSha256Hex);
  assert.equal(r.status, "head-mismatch");
});

test("tamper: naive insertion (copied seq, self-consistent hash) fails at the inserted index", async () => {
  const t = clone();
  const fake = { ...at(t, 1), refId: "forged" };
  fake.hash = await computeEventHash(fake, nodeSha256Hex);
  t.splice(2, 0, fake);
  const r = await node.verifyChain(t);
  assert.ok(!r.ok && r.index === 2 && r.reason.startsWith("seq mismatch"), JSON.stringify(r));
});

test("tamper: well-forged insertion (right seq, linked) fails at the next event", async () => {
  const t = clone();
  const forged = await appendEvent(t.slice(0, 2), { ...inputs[1]!, refId: "forged" }, nodeSha256Hex);
  t.splice(2, 0, forged);
  const r = await node.verifyChain(t);
  assert.ok(!r.ok && r.index === 3 && r.reason === "seq mismatch: expected 4, got 3", JSON.stringify(r));
});

test("tamper: bad genesis prevHash", async () => {
  const t = clone();
  const g = at(t, 0);
  g.prevHash = "1".repeat(64);
  g.hash = await computeEventHash(g, nodeSha256Hex);
  const r = await node.verifyChain(t);
  assert.ok(!r.ok && r.index === 0 && r.reason.startsWith("genesis prevHash"), JSON.stringify(r));
});

test("anchor comparison: verified, head mismatch, count mismatch, no events", async () => {
  const head = at(chain, 4).hash;
  assert.equal((await verifyAgainstAnchor(chain, { headHash: `0x${head.toUpperCase()}` })).status, "verified");
  assert.equal((await verifyAgainstAnchor(chain, { headHash: head, count: 5 })).ok, true);
  assert.equal((await verifyAgainstAnchor(chain, { headHash: "a".repeat(64) })).status, "head-mismatch");
  assert.equal((await verifyAgainstAnchor(chain, { headHash: head, count: 4 })).status, "count-mismatch");
  assert.equal((await verifyAgainstAnchor([], { headHash: head })).status, "no-events");
  assert.equal((await verifyAgainstAnchor(chain, null)).status, "no-anchor");
});

test("sample fixture is a valid chain", async () => {
  const events = parseEventsJson(readFileSync(new URL("../verify/fixtures/sample-chain.json", import.meta.url), "utf8"));
  assert.ok(events.length >= 3);
  assert.deepEqual(await node.verifyChain(events), { ok: true });
});
