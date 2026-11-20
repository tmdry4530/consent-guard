import { test } from "node:test";
import assert from "node:assert/strict";
import type { ViewRequest } from "@consent-guard/ledger/core";
import {
  LABEL_MATCH,
  LABEL_MISMATCH,
  LABEL_UNAVAILABLE,
  compareLive,
  labelBefore,
  readAnchorStatus,
  type AnchorFetch,
  type AnchorRead,
} from "../src/anchorStatus";
import {
  DEFAULT_CONTRACT_ID,
  EXPECTED_ANCHOR_BLOCK,
  EXPECTED_FINAL_COUNT,
  EXPECTED_FINAL_HEAD,
  mockAnchorView,
  resolveAnchorConfig,
} from "../src/anchorConfig";

const HEAD = EXPECTED_FINAL_HEAD;
const N = EXPECTED_FINAL_COUNT;
const OTHER = "ab".repeat(32);
const RPC = "https://rpc.example.test";

/** A NEAR RPC call_function response carrying `value` as JSON bytes. */
function rpcResult(value: unknown) {
  return { jsonrpc: "2.0", id: "consent-guard", result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } };
}

function respond(body: unknown, status = 200): AnchorFetch {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const anchorBody = (head_hash: string, count: number) =>
  rpcResult({ head_hash, count, block_height: EXPECTED_ANCHOR_BLOCK, timestamp_ms: 1_795_182_112_579 });

const read = (fetchImpl: AnchorFetch, timeoutMs = 5000) =>
  readAnchorStatus({ fetchImpl, rpcUrl: RPC, contractId: DEFAULT_CONTRACT_ID, timeoutMs });

const onChain: AnchorRead = {
  kind: "read",
  anchor: { headHash: HEAD, count: N, blockHeight: EXPECTED_ANCHOR_BLOCK, timestampMs: 1_795_182_112_579 },
};

test("read: sends a read_anchor view call to the contract and parses the anchor", async () => {
  let sent: { url: string; body: ViewRequest } | undefined;
  const r = await read(async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => anchorBody(HEAD, N) };
  });
  assert.deepEqual(r, onChain);
  assert.equal(sent?.url, RPC);
  assert.equal(sent?.body.method, "query");
  assert.equal(sent?.body.params.request_type, "call_function");
  assert.equal(sent?.body.params.account_id, DEFAULT_CONTRACT_ID);
  assert.equal(sent?.body.params.method_name, "read_anchor");
});

test("before: live ledger shorter than the anchor shows '{anchor}건 중 {live}건 · 앵커 전'", () => {
  const r = compareLive(onChain, { count: 6, head: OTHER, chainOk: true });
  assert.equal(r.kind, "before");
  assert.equal(r.label, `${N}건 중 6건 · 앵커 전`);
  assert.equal(r.label, labelBefore(N, 6));
  assert.equal(r.blockHeight, EXPECTED_ANCHOR_BLOCK);
});

test("match: same count and same head", () => {
  const r = compareLive(onChain, { count: N, head: HEAD, chainOk: true });
  assert.equal(r.kind, "match");
  assert.equal(r.label, LABEL_MATCH);
  assert.equal(r.label, "현재 장부 = 온체인 앵커 일치 ✓");
  assert.equal(r.anchorHead, HEAD);
  assert.equal(r.blockHeight, EXPECTED_ANCHOR_BLOCK);
});

test("mismatch: same count, different head", () => {
  const r = compareLive(onChain, { count: N, head: OTHER, chainOk: true });
  assert.equal(r.kind, "mismatch");
  assert.equal(r.label, LABEL_MISMATCH);
  assert.match(r.reason, /헤드 해시 불일치/);
});

test("mismatch: live ledger longer than the anchor", () => {
  const r = compareLive(onChain, { count: N + 1, head: OTHER, chainOk: true });
  assert.equal(r.kind, "mismatch");
  assert.match(r.reason, new RegExp(`건수 초과.*${N + 1}건.*${N}건`));
});

test("mismatch: a broken live chain never matches, even with the right head", () => {
  const r = compareLive(onChain, { count: N, head: HEAD, chainOk: false });
  assert.equal(r.kind, "mismatch");
  assert.match(r.reason, /해시 체인이 손상/);
});

test("mismatch: contract has no anchor yet (read_anchor -> null)", async () => {
  const r = await read(respond(rpcResult(null)));
  assert.deepEqual(r, { kind: "read", anchor: null });
  assert.equal(compareLive(r, { count: N, head: HEAD }).kind, "mismatch");
});

test("unavailable: HTTP failure", async () => {
  const r = await read(respond({}, 503));
  assert.equal(r.kind, "unavailable");
  const s = compareLive(r, { count: N, head: HEAD });
  assert.equal(s.kind, "unavailable");
  assert.equal(s.label, LABEL_UNAVAILABLE);
  assert.match(s.reason, /503/);
});

test("unavailable: JSON-RPC error body", async () => {
  const r = await read(respond({ jsonrpc: "2.0", id: "x", error: { cause: { name: "UNKNOWN_ACCOUNT" } } }));
  assert.equal(r.kind, "unavailable");
  assert.match(compareLive(r, { count: 0 }).reason, /RPC 응답 오류/);
});

test("unavailable: network error / offline", async () => {
  const r = await read(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(r.kind, "unavailable");
  assert.match(compareLive(r, { count: 0 }).reason, /네트워크 오류/);
});

test("unavailable: aborted request", async () => {
  const r = await read(async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  });
  assert.equal(r.kind, "unavailable");
});

test("unavailable: timeout aborts the request even if fetch never settles", async () => {
  let signal: AbortSignal | undefined;
  const started = Date.now();
  const r = await read((_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  }, 50);
  assert.equal(r.kind, "unavailable");
  assert.match(compareLive(r, { count: 0 }).reason, /시간 초과/);
  assert.equal(signal?.aborted, true);
  assert.ok(Date.now() - started < 2000);
});

test("config: defaults, env overrides, and ?rpc/&contract runtime overrides", () => {
  const d = resolveAnchorConfig();
  assert.equal(d.rpcUrl, "https://rpc.testnet.near.org");
  assert.equal(d.txUrl, "https://testnet.nearblocks.io/txns/51udtFvQ4Po2E4Pj6H2gTTKAvK2VRKCGgBeAN7A25P2y");
  assert.equal(d.accountUrl, `https://testnet.nearblocks.io/address/${DEFAULT_CONTRACT_ID}`);
  assert.equal(d.timeoutMs, 5000);

  const e = resolveAnchorConfig({ VITE_NEAR_RPC_URL: "https://rpc.env", VITE_ANCHOR_TX_URL: "HASH123" }, "?contract=c.testnet");
  assert.equal(e.rpcUrl, "https://rpc.env");
  assert.equal(e.contractId, "c.testnet");
  assert.equal(e.txUrl, "https://testnet.nearblocks.io/txns/HASH123");
  assert.equal(e.accountUrl, "https://testnet.nearblocks.io/address/c.testnet");
  assert.equal(resolveAnchorConfig({}, "?rpc=http://127.0.0.1:9/").rpcUrl, "http://127.0.0.1:9/");
});

test("config: mock mode via ?mock=1 / ?mock=true / VITE_ANCHOR_MOCK, off by default and for ?mock=0", () => {
  assert.equal(resolveAnchorConfig().mock, false);
  assert.equal(resolveAnchorConfig({}, "?mock=0").mock, false);
  assert.equal(resolveAnchorConfig({ VITE_ANCHOR_MOCK: "0" }).mock, false);
  assert.equal(resolveAnchorConfig({}, "?mock=1").mock, true);
  assert.equal(resolveAnchorConfig({}, "?mock=true").mock, true);
  assert.equal(resolveAnchorConfig({ VITE_ANCHOR_MOCK: "1" }).mock, true);
  assert.equal(resolveAnchorConfig({ VITE_ANCHOR_MOCK: "true" }).mock, true);
});

test("mock: canned anchor is the final demo anchor and matches the finished demo ledger", () => {
  const view = mockAnchorView();
  assert.equal(view.headHash, "259dbd26b973e4a7e8252488ce2a4d97d532f8355825b4edc3722c97b20fa95b");
  assert.equal(view.count, 11);
  assert.equal(view.blockHeight, 278539285);
  assert.equal(view.timestampMs, Date.UTC(2026, 10, 20, 13, 41, 52));
  const r = compareLive({ kind: "read", anchor: view }, { count: 11, head: EXPECTED_FINAL_HEAD, chainOk: true });
  assert.equal(r.kind, "match");
  assert.match(r.label, /일치 ✓/);
});
