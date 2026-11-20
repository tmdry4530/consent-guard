import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, eventHashPayload } from "../src/core.js";

test("key order does not matter, nested objects sorted too", () => {
  const a = { b: 1, a: { y: [3, 1, 2], x: "s" }, c: null };
  const b = { c: null, a: { x: "s", y: [3, 1, 2] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"a":{"x":"s","y":[3,1,2]},"b":1,"c":null}');
});

test("arrays keep element order", () => {
  assert.notEqual(canonicalJson({ f: ["a", "b"] }), canonicalJson({ f: ["b", "a"] }));
  assert.equal(canonicalJson([{ b: 2, a: 1 }, [2, 1]]), '[{"a":1,"b":2},[2,1]]');
});

test("undefined object values are omitted; null is kept", () => {
  assert.equal(canonicalJson({ a: undefined, b: null, c: { d: undefined } }), '{"b":null,"c":{}}');
});

test("primitives encode like JSON.stringify, including unicode and escapes", () => {
  for (const v of ["동의 ✓ 🔒", 'q"\\\n\t', "\u2028", 0, -0, 1.5, 1e21, true, false, null]) {
    assert.equal(canonicalJson(v), JSON.stringify(v));
  }
  assert.equal(canonicalJson({ "키": "값", a: "é" }), '{"a":"é","키":"값"}');
});

test("non-JSON values are rejected instead of silently hashed", () => {
  assert.throws(() => canonicalJson(Number.NaN));
  assert.throws(() => canonicalJson(Infinity));
  assert.throws(() => canonicalJson(1n));
});

test("hash payload omits hash and anchorTx only", () => {
  const e = {
    seq: 1, kind: "grant" as const, at: 1, agentId: "a", dataset: "d", fields: ["x"], refId: "r",
    prevHash: "0".repeat(64), hash: "f".repeat(64), anchorTx: "TX",
  };
  assert.equal(eventHashPayload(e), `{"agentId":"a","at":1,"dataset":"d","fields":["x"],"kind":"grant","prevHash":"${"0".repeat(64)}","refId":"r","seq":1}`);
});
