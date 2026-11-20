// Offline NEAR RPC mock + loose anchor-panel assertions, shared by e2e/demo.spec.ts and
// scripts/record-demo.mjs (Node imports this .ts directly via type stripping: keep syntax erasable).
// Install before page.goto so the app's first read_anchor call never leaves the box.
//
// Assertions stay on stable hooks (testid + data-kind) because the anchor copy/semantics are
// about to change (current ledger head vs on-chain anchor instead of the bundled sample snapshot).
import type { Page, Route } from "@playwright/test";

/** anchorConfig.ts DEFAULT_RPC_URL; the app only uses another URL via VITE_NEAR_RPC_URL / ?rpc=. */
export const RPC_URL = "https://rpc.testnet.near.org";

/** Last event hash of packages/ledger/verify/fixtures/sample-chain.json (the bundled 5-event snapshot). */
export const SAMPLE_HEAD_HASH = "85c3a623b71c66b803e8dfdb20ff54fa09c3ceac8f2deca58a9b7d637c4228ce";
export const SAMPLE_COUNT = 5;

export type AnchorMockMode = "match" | "mismatch" | "unavailable";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

/** Routes every request to the RPC (origin+pathname, trailing slash ignored) to a canned read_anchor reply. */
export async function mockAnchorRpc(page: Page, mode: AnchorMockMode = "match", rpcUrl: string = RPC_URL): Promise<void> {
  const target = rpcUrl.replace(/\/+$/, "");
  await page.route((url) => `${url.origin}${url.pathname}`.replace(/\/+$/, "") === target, (route: Route) => {
    if (mode === "unavailable") return route.abort("internetdisconnected");
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const value = {
      head_hash: mode === "match" ? SAMPLE_HEAD_HASH : "ab".repeat(32),
      count: SAMPLE_COUNT,
      block_height: 250_000_000,
      timestamp_ms: Date.UTC(2026, 10, 20, 11, 0, 0),
    };
    return route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "consent-guard",
        // NEAR view-call shape: the JSON return value as a UTF-8 byte array.
        result: { result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [], block_height: 250_000_001 },
      }),
    });
  });
}

const KIND_TIMEOUT_MS = 10_000;

/**
 * Waits until the anchor panel is visible with the expected data-kind and mentions "앵커".
 * Plain waits (no expect) so the .mjs recorder can use it too; throws on timeout.
 */
export async function waitForAnchorStatus(page: Page, kind: AnchorMockMode = "match"): Promise<void> {
  const status = page.getByTestId("anchor-status");
  await status.waitFor({ state: "visible", timeout: KIND_TIMEOUT_MS });
  await page.locator(`[data-testid="anchor-status"][data-kind="${kind}"]`).waitFor({ timeout: KIND_TIMEOUT_MS });
  const text = await status.innerText();
  if (!text.includes("앵커")) throw new Error(`anchor-status text lacks "앵커": ${text}`);
}
