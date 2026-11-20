import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeEventHash, eventHashPayload, parseEventsJson, verifyChain, webCryptoSha256Hex } from "../src/core.js";
import { nodeSha256Hex } from "../src/index.ts";
// @ts-expect-error -- plain browser JS without declarations; imported to test the page's own code path
import { pageSha256Hex, runVerification } from "../verify/page-logic.js";

const fixtureText = readFileSync(new URL("../verify/fixtures/sample-chain.json", import.meta.url), "utf8");
const events = parseEventsJson(fixtureText);

test("sha256 known vectors: node:crypto == WebCrypto == page", async () => {
  const vectors: [string, string][] = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ];
  for (const [text, hex] of vectors) {
    assert.equal(nodeSha256Hex(text), hex);
    assert.equal(await webCryptoSha256Hex(text), hex);
    assert.equal(await pageSha256Hex(text), hex);
  }
  const uni = "동의 ✓ 🔒 \u2028";
  assert.equal(await webCryptoSha256Hex(uni), nodeSha256Hex(uni));
  assert.equal(await pageSha256Hex(uni), nodeSha256Hex(uni));
});

test("every fixture event hash is identical across node:crypto, WebCrypto and the page path", async () => {
  for (const e of events) {
    const payload = eventHashPayload(e);
    const viaNode = await computeEventHash(e, nodeSha256Hex);
    assert.equal(viaNode, e.hash);
    assert.equal(await computeEventHash(e, webCryptoSha256Hex), viaNode);
    assert.equal(await pageSha256Hex(payload), viaNode);
  }
  assert.deepEqual(await verifyChain(events, nodeSha256Hex), await verifyChain(events, pageSha256Hex));
});

test("page verification: pasted matching head is green, mismatched is red, tamper names the index", async () => {
  const head = events.at(-1)!.hash;
  const green = await runVerification({ eventsText: fixtureText, anchorSource: "pasted", pastedHead: head });
  assert.equal(green.ok, true);
  assert.equal(green.status, "verified");

  const red = await runVerification({ eventsText: fixtureText, anchorSource: "pasted", pastedHead: "b".repeat(64) });
  assert.equal(red.ok, false);
  assert.equal(red.status, "head-mismatch");

  const tampered = structuredClone(events);
  tampered[1]!.fields = ["everything"];
  const bad = await runVerification({ eventsText: JSON.stringify(tampered), anchorSource: "pasted", pastedHead: head });
  assert.equal(bad.status, "chain-invalid");
  assert.equal(bad.index, 1);

  const empty = await runVerification({ eventsText: "", anchorSource: "pasted", pastedHead: head });
  assert.equal(empty.status, "no-events");
});

test("page verification reads the on-chain anchor through the RPC view", async () => {
  const head = events.at(-1)!.hash;
  const value = { head_hash: head, count: events.length, block_height: 1, timestamp_ms: 2 };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } }) });
  const r = await runVerification({ eventsText: fixtureText, anchorSource: "rpc", rpcUrl: "https://rpc.example", contractId: "c.testnet", fetchImpl });
  assert.equal(r.status, "verified");
  const none = async () => ({ ok: true, status: 200, json: async () => ({ result: { result: [...new TextEncoder().encode("null")] } }) });
  const r2 = await runVerification({ eventsText: fixtureText, anchorSource: "rpc", rpcUrl: "https://rpc.example", contractId: "c.testnet", fetchImpl: none });
  assert.equal(r2.status, "no-anchor");
});
