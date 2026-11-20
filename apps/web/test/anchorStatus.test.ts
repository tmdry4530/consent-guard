import { test } from "node:test";
import assert from "node:assert/strict";
import type { ViewRequest } from "@consent-guard/ledger/core";
import { checkAnchorStatus, SAMPLE_SNAPSHOT, type AnchorFetch } from "../src/anchorStatus";
import { DEFAULT_CONTRACT_ID, resolveAnchorConfig } from "../src/anchorConfig";

const SAMPLE_HEAD = "85c3a623b71c66b803e8dfdb20ff54fa09c3ceac8f2deca58a9b7d637c4228ce";
const RPC = "https://rpc.example.test";

/** A NEAR RPC call_function response carrying `value` as JSON bytes. */
function rpcResult(value: unknown) {
  return { jsonrpc: "2.0", id: "consent-guard", result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } };
}

function respond(body: unknown, status = 200): AnchorFetch {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const anchor = (head_hash: string, count: number) =>
  rpcResult({ head_hash, count, block_height: 222_333_444, timestamp_ms: 1_795_165_500_000 });

const run = (fetchImpl: AnchorFetch, timeoutMs = 5000) =>
  checkAnchorStatus({ fetchImpl, rpcUrl: RPC, contractId: DEFAULT_CONTRACT_ID, timeoutMs });

test("match: on-chain head and count equal the bundled 5-event sample snapshot", async () => {
  let sent: { url: string; body: ViewRequest } | undefined;
  const r = await run(async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => anchor(SAMPLE_HEAD, 5) };
  });
  assert.equal(r.kind, "match");
  assert.equal(r.compared, "sample-snapshot");
  assert.equal(r.snapshotCount, 5);
  assert.equal(SAMPLE_SNAPSHOT.length, 5);
  assert.equal(r.head, SAMPLE_HEAD);
  assert.equal(r.anchorHead, SAMPLE_HEAD);
  assert.equal(r.blockHeight, 222_333_444);
  assert.equal(sent?.body.params.account_id, DEFAULT_CONTRACT_ID);
  assert.equal(sent?.body.params.method_name, "read_anchor");
});

test("mismatch: wrong head", async () => {
  const r = await run(respond(anchor("ab".repeat(32), 5)));
  assert.equal(r.kind, "mismatch");
  assert.match(r.reason, /헤드 해시 불일치/);
  assert.equal(r.head, SAMPLE_HEAD);
  assert.equal(r.anchorHead, "ab".repeat(32));
  assert.equal(r.blockHeight, 222_333_444);
});

test("mismatch: right head, wrong count", async () => {
  const r = await run(respond(anchor(SAMPLE_HEAD, 6)));
  assert.equal(r.kind, "mismatch");
  assert.match(r.reason, /건수 불일치.*5건.*6건/);
});

test("mismatch: tampered snapshot chain is reported as chain damage, not a match", async () => {
  const tampered = SAMPLE_SNAPSHOT.map((e, i) => (i === 2 ? { ...e, agentId: "evil-agent" } : e));
  const r = await checkAnchorStatus({
    fetchImpl: respond(anchor(SAMPLE_HEAD, 5)),
    rpcUrl: RPC,
    contractId: DEFAULT_CONTRACT_ID,
    timeoutMs: 5000,
    snapshot: tampered,
  });
  assert.equal(r.kind, "mismatch");
  assert.match(r.reason, /스냅샷 해시 체인 손상/);
});

test("mismatch: contract has no anchor yet (read_anchor -> null)", async () => {
  const r = await run(respond(rpcResult(null)));
  assert.equal(r.kind, "mismatch");
});

test("unavailable: HTTP failure", async () => {
  const r = await run(respond({}, 503));
  assert.equal(r.kind, "unavailable");
  assert.match(r.reason, /503/);
});

test("unavailable: JSON-RPC error body", async () => {
  const r = await run(respond({ jsonrpc: "2.0", id: "x", error: { cause: { name: "UNKNOWN_ACCOUNT" } } }));
  assert.equal(r.kind, "unavailable");
  assert.match(r.reason, /RPC 응답 오류/);
});

test("unavailable: network error / offline", async () => {
  const r = await run(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(r.kind, "unavailable");
  assert.match(r.reason, /네트워크 오류/);
});

test("unavailable: aborted request", async () => {
  const r = await run(async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  });
  assert.equal(r.kind, "unavailable");
});

test("unavailable: timeout aborts the request even if fetch never settles", async () => {
  let signal: AbortSignal | undefined;
  const started = Date.now();
  const r = await run((_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  }, 50);
  assert.equal(r.kind, "unavailable");
  assert.match(r.reason, /시간 초과/);
  assert.equal(signal?.aborted, true);
  assert.ok(Date.now() - started < 2000);
});

test("config: defaults, env overrides, and ?rpc/&contract runtime overrides", () => {
  const d = resolveAnchorConfig();
  assert.equal(d.rpcUrl, "https://rpc.testnet.near.org");
  assert.equal(d.txUrl, "https://testnet.nearblocks.io/txns/Gx1HfEQYRQh9RwLr1DJstmV6m6dJEaCFQ3RnXM39bHhE");
  assert.equal(d.accountUrl, `https://testnet.nearblocks.io/address/${DEFAULT_CONTRACT_ID}`);
  assert.equal(d.timeoutMs, 5000);

  const e = resolveAnchorConfig({ VITE_NEAR_RPC_URL: "https://rpc.env", VITE_ANCHOR_TX_URL: "HASH123" }, "?contract=c.testnet");
  assert.equal(e.rpcUrl, "https://rpc.env");
  assert.equal(e.contractId, "c.testnet");
  assert.equal(e.txUrl, "https://testnet.nearblocks.io/txns/HASH123");
  assert.equal(e.accountUrl, "https://testnet.nearblocks.io/address/c.testnet");
  assert.equal(resolveAnchorConfig({}, "?rpc=http://127.0.0.1:9/").rpcUrl, "http://127.0.0.1:9/");
});
