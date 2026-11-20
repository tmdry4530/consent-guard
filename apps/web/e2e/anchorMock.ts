// Offline NEAR RPC mock + loose anchor-panel assertions, shared by e2e/demo.spec.ts and
// scripts/record-demo.mjs (Node imports this .ts directly via type stripping: keep syntax erasable).
// Install before page.goto so the app's first read_anchor call never leaves the box.
//
// The mocked anchor is the final head/count of the live 5-scene demo ledger, so the panel reads
// "before" during scenes 1–4 and "match" once scene 5 (revoke) brings the ledger to 11 events.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import {
  DEFAULT_RPC_URL,
  EXPECTED_ANCHOR_BLOCK,
  EXPECTED_FINAL_COUNT,
  EXPECTED_FINAL_HEAD,
} from "../src/anchorConfig.ts";

export const RPC_URL = DEFAULT_RPC_URL;

export type AnchorMockMode = "match" | "mismatch" | "unavailable";
export type AnchorKind = "before" | "match" | "mismatch" | "unavailable";

export interface DemoAnchor {
  head: string;
  count: number;
  /** "scenario": computed by runDemoScenario(); "constants": anchorConfig EXPECTED_* (tsx not installed). */
  source: "scenario" | "constants";
}

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
const FINAL_HEAD_SCRIPT = `import("./src/demoScenario.ts").then(async (m) => {
  const s = await m.runDemoScenario();
  const l = s[s.length - 1].ledger;
  process.stdout.write(JSON.stringify({ head: l[l.length - 1].hash, count: l.length }));
});`;

/**
 * Final head/count of the live demo ledger, checked against anchorConfig EXPECTED_FINAL_* (throws if they differ).
 * runDemoScenario() runs under tsx in a child process (as the web unit tests do): demoScenario.ts can't be
 * imported in-process here — its JSON fixture imports lack `with { type: "json" }` (Playwright's loader rejects
 * them) and its imports are extensionless (plain Node type stripping in record-demo.mjs can't resolve them).
 * Falls back to the EXPECTED_* constants only if tsx itself isn't installed.
 */
export async function demoAnchor(): Promise<DemoAnchor> {
  let tsxCli: string;
  try {
    tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  } catch {
    return { head: EXPECTED_FINAL_HEAD, count: EXPECTED_FINAL_COUNT, source: "constants" };
  }
  const out = execFileSync(process.execPath, [tsxCli, "-e", FINAL_HEAD_SCRIPT], { cwd: WEB_DIR, encoding: "utf8" });
  const { head, count } = JSON.parse(out) as { head: string; count: number };
  if (head !== EXPECTED_FINAL_HEAD || count !== EXPECTED_FINAL_COUNT) {
    throw new Error(
      `demo ledger final head/count ${head}/${count} != EXPECTED_FINAL_* ${EXPECTED_FINAL_HEAD}/${EXPECTED_FINAL_COUNT}`,
    );
  }
  return { head, count, source: "scenario" };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

/**
 * Routes every request to the RPC (origin+pathname, trailing slash ignored) to a canned read_anchor reply.
 * "match" anchors the final demo head; "mismatch" anchors another head with the same count.
 */
export async function mockAnchorRpc(
  page: Page,
  mode: AnchorMockMode = "match",
  rpcUrl: string = RPC_URL,
): Promise<DemoAnchor> {
  const anchor = await demoAnchor();
  const target = rpcUrl.replace(/\/+$/, "");
  await page.route((url) => `${url.origin}${url.pathname}`.replace(/\/+$/, "") === target, (route: Route) => {
    if (mode === "unavailable") return route.abort("internetdisconnected");
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const value = {
      head_hash: mode === "match" ? anchor.head : "ab".repeat(32),
      count: anchor.count,
      block_height: EXPECTED_ANCHOR_BLOCK,
      timestamp_ms: Date.UTC(2026, 10, 20, 13, 41, 52),
    };
    return route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "consent-guard",
        // NEAR view-call shape: the JSON return value as a UTF-8 byte array.
        result: {
          result: [...new TextEncoder().encode(JSON.stringify(value))],
          logs: [],
          block_height: EXPECTED_ANCHOR_BLOCK + 1,
        },
      }),
    });
  });
  return anchor;
}

const KIND_TIMEOUT_MS = 15_000;

/**
 * Waits until the anchor panel is visible with the expected data-kind and mentions "앵커".
 * Plain waits (no expect) so the .mjs recorder can use it too; throws on timeout.
 */
export async function waitForAnchorStatus(page: Page, kind: AnchorKind): Promise<void> {
  const status = page.getByTestId("anchor-status");
  await status.waitFor({ state: "visible", timeout: KIND_TIMEOUT_MS });
  await page.locator(`[data-testid="anchor-status"][data-kind="${kind}"]`).waitFor({ timeout: KIND_TIMEOUT_MS });
  const text = await status.innerText();
  if (!text.includes("앵커")) throw new Error(`anchor-status text lacks "앵커": ${text}`);
}

/** Current data-kind and label text of the anchor panel (for logging / failure messages). */
export async function readAnchorStatus(page: Page): Promise<{ kind: string | null; label: string }> {
  const status = page.getByTestId("anchor-status");
  return {
    kind: await status.getAttribute("data-kind"),
    label: (await page.getByTestId("anchor-label").innerText()).trim(),
  };
}
