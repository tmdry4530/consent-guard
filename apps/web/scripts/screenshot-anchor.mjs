// Screenshots of the audit-log on-chain anchor status at 1280×800, driving the demo scenes like a user:
//   anchor-before.png      mid-demo (after scene 3), live public RPC → "11건 중 8건 · 앵커 전"
//   anchor-match.png       end of demo (scene 5), live public RPC → "현재 장부 = 온체인 앵커 일치 ✓"
//   anchor-mismatch.png    end of demo, read_anchor mocked with a different head → "온체인 앵커 불일치 ✗"
//   anchor-unavailable.png RPC request aborted (offline) → "앵커 확인 불가"
//   node apps/web/scripts/screenshot-anchor.mjs                        # spawns `vite` on 127.0.0.1:4177
//   BASE_URL=http://127.0.0.1:4173 node apps/web/scripts/screenshot-anchor.mjs   # use a running server
// Env: OUT_DIR (default <repo>/evidence/anchor-status/), RPC_URL (the RPC the app
// calls; default https://rpc.testnet.near.org), PORT (default 4177). before/match hit the live public RPC.
// Exits 1 if a state never appears or the anchor status overflows the audit-log card / viewport.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { resolveChromePath } from "./chromePath.mjs";

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const PORT = Number(process.env.PORT ?? 4177);
const OUT_DIR = process.env.OUT_DIR ?? join(repoRoot, "evidence/anchor-status");
const RPC_URL = (process.env.RPC_URL ?? "https://rpc.testnet.near.org").replace(/\/+$/, "");
const VIEWPORT = { width: 1280, height: 800 };
const OTHER_HEAD = "ab".repeat(32);
mkdirSync(OUT_DIR, { recursive: true });

let server;
let BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  BASE_URL = `http://127.0.0.1:${PORT}`;
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: WEB_DIR,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(BASE_URL)).ok) break;
    } catch {}
    if (Date.now() > deadline || server.exitCode !== null) {
      stopServer();
      throw new Error(`dev server did not come up on ${BASE_URL}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
}

const isRpc = (url) => `${url.origin}${url.pathname}`.replace(/\/+$/, "") === RPC_URL;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const bytes = (value) => [...new TextEncoder().encode(JSON.stringify(value))];

const failures = [];

const rows = (page) => page.locator('[data-testid="audit-log"] tbody tr');

/** Plays the demo up to `scene` (2 = initial feed only, 3 = approve, 4 = +10분, 5 = revoke). */
async function playTo(page, scene) {
  const steps = [
    [3, "approve-req-medical-full", 8],
    [4, "advance-clock", 9],
    [5, "revoke-grant-card-budget", 11],
  ];
  for (const [s, testId, count] of steps) {
    if (s > scene) break;
    await page.getByTestId(testId).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="audit-log"] tbody tr').length === n,
      count,
    );
  }
}

async function shoot(browser, name, scene, waitText, setupRoute) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    if (setupRoute) await page.route(isRpc, setupRoute);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const audit = page.getByTestId("audit-log");
    await audit.getByText("감사 로그").first().waitFor();
    await page.getByText("해시 체인 검증 ✓").waitFor();
    await playTo(page, scene);
    await page.getByText("해시 체인 검증 ✓").waitFor();
    const head = (await rows(page).first().locator("td.hash").getAttribute("title")).split("\n")[0];
    const status = page.getByTestId("anchor-status");
    await status.getByText(waitText).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);

    const card = await audit.boundingBox();
    const box = await status.boundingBox();
    const fits =
      box.x >= card.x && box.x + box.width <= card.x + card.width + 0.5 && card.y + card.height <= VIEWPORT.height + 0.5;
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(
      `[${name}] scene ${scene}, ${await rows(page).count()} events, live head ${head}\n  ${(await status.innerText()).replace(/\s+/g, " ")}\n  anchor y=${box.y.toFixed(0)} h=${box.height.toFixed(0)} card bottom=${(card.y + card.height).toFixed(0)} ${fits && !overflowX ? "OK" : "OVERFLOW"}`,
    );
    if (!fits || overflowX) failures.push(`${name}: anchor status overflows the audit-log card or viewport`);
    await page.screenshot({ path: join(OUT_DIR, name) });
  } catch (e) {
    failures.push(`${name}: ${e.message.split("\n")[0]}`);
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({
  executablePath: resolveChromePath(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  // Live public RPC, no mock: mid-demo, then end of demo.
  await shoot(browser, "anchor-before.png", 3, "11건 중 8건 · 앵커 전");
  await shoot(browser, "anchor-match.png", 5, "현재 장부 = 온체인 앵커 일치 ✓");

  // End of demo, successful read_anchor with a different head (same count).
  await shoot(browser, "anchor-mismatch.png", 5, "온체인 앵커 불일치", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const value = { head_hash: OTHER_HEAD, count: 11, block_height: 250_000_000, timestamp_ms: Date.now() };
    return route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "consent-guard", result: { result: bytes(value), logs: [], block_height: 250_000_001 } }),
    });
  });

  // RPC unreachable.
  await shoot(browser, "anchor-unavailable.png", 5, "앵커 확인 불가", (route) => route.abort("internetdisconnected"));

  console.log(`screenshots written to ${OUT_DIR}`);
} finally {
  await browser.close();
  stopServer();
}

if (failures.length > 0) {
  console.error(`anchor screenshot check FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("anchor screenshot check passed");
