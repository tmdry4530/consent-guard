import { test } from "node:test";
import assert from "node:assert/strict";
import { GENESIS_HASH, append, list, verifyChain, type LedgerInput } from "../src/ledgerAdapter";

const inputs: LedgerInput[] = [
  { kind: "grant", at: 1, agentId: "a", dataset: "card_tx", fields: ["amount"], refId: "g1" },
  { kind: "access", at: 2, agentId: "a", dataset: "card_tx", fields: ["amount"], refId: "r1" },
  { kind: "revoke", at: 3, agentId: "a", dataset: "card_tx", fields: ["amount"], refId: "g1" },
];

test("append builds a verifiable sha256 chain", async () => {
  const chain = await append([], inputs);
  assert.deepEqual(chain.map((e) => e.seq), [1, 2, 3]);
  assert.equal(chain[0].prevHash, GENESIS_HASH);
  assert.equal(chain[1].prevHash, chain[0].hash);
  assert.match(chain[2].hash, /^[0-9a-f]{64}$/);
  assert.equal(await verifyChain(chain), true);
  assert.deepEqual(list(chain).map((e) => e.seq), [3, 2, 1]);
});

test("append does not mutate the input chain", async () => {
  const one = await append([], inputs.slice(0, 1));
  await append(one, inputs.slice(1));
  assert.equal(one.length, 1);
});

test("tampering is detected", async () => {
  const chain = await append([], inputs);
  assert.equal(await verifyChain(chain.map((e, i) => (i === 1 ? { ...e, fields: ["merchant"] } : e))), false);
  assert.equal(await verifyChain(chain.map((e, i) => (i === 0 ? { ...e, hash: "f".repeat(64) } : e))), false);
  assert.equal(await verifyChain([chain[0], chain[2]]), false);
});
