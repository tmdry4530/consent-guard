import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnchorAdapter } from "../src/anchor.ts";
import { buildViewRequest, decodeViewResponse, type FetchLike, type ViewRequest } from "../src/core.js";
import { DEFAULT_CONTRACT_ID, PARENT_ACCOUNT_ID } from "../src/near.ts";

const HEAD = "1533e794f9269bc5945ae2abc315492e76bce1653d0562c55ce70da15d63d899";
const bytes = (v: unknown) => [...new TextEncoder().encode(JSON.stringify(v))];

function mockRpc(result: unknown) {
  const calls: { url: string; body: ViewRequest }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => result };
  };
  return { calls, fetchImpl };
}

test("readAnchor posts a read_anchor view and decodes the byte-array result", async () => {
  const rpc = mockRpc({
    jsonrpc: "2.0", id: "consent-guard",
    result: { result: bytes({ head_hash: HEAD, count: 5, block_height: 123, timestamp_ms: 1700 }), logs: [], block_height: 130 },
  });
  const a = createAnchorAdapter({ rpcUrl: "https://rpc.testnet.fastnear.com", contractId: "c.testnet", fetchImpl: rpc.fetchImpl });
  assert.deepEqual(await a.readAnchor(), { headHash: HEAD, count: 5, blockHeight: 123, timestampMs: 1700 });
  assert.equal(rpc.calls.length, 1);
  const { url, body } = rpc.calls[0]!;
  assert.equal(url, "https://rpc.testnet.fastnear.com");
  assert.equal(body.method, "query");
  assert.equal(body.params.request_type, "call_function");
  assert.equal(body.params.account_id, "c.testnet");
  assert.equal(body.params.method_name, "read_anchor");
  assert.equal(atob(body.params.args_base64), "{}");
});

test("readAnchor returns null when nothing is anchored", async () => {
  const rpc = mockRpc({ result: { result: bytes(null), logs: [] } });
  assert.equal(await createAnchorAdapter({ fetchImpl: rpc.fetchImpl }).readAnchor(), null);
});

test("readAnchor surfaces contract/RPC errors (e.g. MethodNotFound on the wrong contract)", async () => {
  const rpc = mockRpc({ result: { error: "wasm execution failed with error: MethodResolveError(MethodNotFound)", logs: [] } });
  await assert.rejects(createAnchorAdapter({ fetchImpl: rpc.fetchImpl }).readAnchor(), /MethodNotFound/);
  const rpc2 = mockRpc({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } });
  await assert.rejects(createAnchorAdapter({ fetchImpl: rpc2.fetchImpl }).readAnchor(), /UNKNOWN_ACCOUNT/);
});

test("decodeViewResponse also accepts a base64 result", () => {
  const b64 = btoa(JSON.stringify({ head_hash: HEAD, count: 1, block_height: 1, timestamp_ms: 1 }));
  assert.deepEqual(decodeViewResponse({ result: { result: b64 } }), { head_hash: HEAD, count: 1, block_height: 1, timestamp_ms: 1 });
  const argsBytes = Uint8Array.from(atob(buildViewRequest("x", "m", { a: "é✓" }).params.args_base64), (c) => c.charCodeAt(0));
  assert.equal(new TextDecoder().decode(argsBytes), '{"a":"é✓"}'); // args are UTF-8 before base64
});

test("dry-run anchor (default) returns a descriptor and touches no network or signer", async () => {
  let fetched = 0;
  const fetchImpl: FetchLike = async () => { fetched++; throw new Error("must not fetch"); };
  const a = createAnchorAdapter({ fetchImpl, credentialsPath: "/nonexistent/creds.json" });
  assert.equal(a.dryRun, true);
  const r = await a.anchor(`0x${HEAD.toUpperCase()}`, 5);
  assert.equal(fetched, 0);
  assert.equal(r.dryRun, true);
  assert.equal(r.method, "anchor");
  assert.deepEqual(r.args, { head_hash: HEAD, count: 5 });
  assert.equal(r.contractId, DEFAULT_CONTRACT_ID);
  assert.notEqual(r.contractId, PARENT_ACCOUNT_ID);
  assert.equal(r.credentialsExist, false);
  assert.ok(!("txHash" in r));
});

test("anchor validates head hash and count before anything else", async () => {
  const a = createAnchorAdapter();
  await assert.rejects(a.anchor("abcd", 1), /64 hex/);
  await assert.rejects(a.anchor(HEAD, 0), /positive integer/);
});

test("live path still requires credentials (no send without them)", async () => {
  let fetched = 0;
  const fetchImpl: FetchLike = async () => { fetched++; throw new Error("must not fetch"); };
  const a = createAnchorAdapter({ dryRun: false, fetchImpl, credentialsPath: "/nonexistent/creds.json" });
  await assert.rejects(a.anchor(HEAD, 1), /credentials file not found/);
  assert.equal(fetched, 0);
});
