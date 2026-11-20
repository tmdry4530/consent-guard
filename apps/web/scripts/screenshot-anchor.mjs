// Screenshots of the audit-log on-chain anchor status at 1280×800: live match, mocked mismatch, RPC failure.
//   node apps/web/scripts/screenshot-anchor.mjs                        # spawns `vite` on 127.0.0.1:4177
//   BASE_URL=http://127.0.0.1:4173 node apps/web/scripts/screenshot-anchor.mjs   # use a running server
// Env: OUT_DIR (default /workspace/company/dev3-logs/nesa-anchor-ui-evidence/), RPC_URL (the RPC the app
// calls; default https://rpc.testnet.near.org), PORT (default 4177). anchor-match.png hits the live public RPC.
// Exits 1 if a state never appears or the anchor status overflows the audit-log card / viewport.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/tmp/c9-video-tools/node_modules/playwright-core/index.mjs";

const PORT = Number(process.env.PORT ?? 4177);
const OUT_DIR = process.env.OUT_DIR ?? "/workspace/company/dev3-logs/nesa-anchor-ui-evidence/";
const RPC_URL = (process.env.RPC_URL ?? "https://rpc.testnet.near.org").replace(/\/+$/, "");
const VIEWPORT = { width: 1280, height: 800 };
const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
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

async function shoot(browser, name, waitText, setupRoute) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    if (setupRoute) await page.route(isRpc, setupRoute);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    const audit = page.getByTestId("audit-log");
    await audit.getByText("감사 로그").first().waitFor();
    await page.getByText("해시 체인 검증 ✓").waitFor();
    const status = page.getByTestId("anchor-status");
    await status.getByText(waitText).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);

    const card = await audit.boundingBox();
    const box = await status.boundingBox();
    const fits =
      box.x >= card.x && box.x + box.width <= card.x + card.width + 0.5 && card.y + card.height <= VIEWPORT.height + 0.5;
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(
      `[${name}] ${(await status.innerText()).replace(/\s+/g, " ")}\n  anchor y=${box.y.toFixed(0)} h=${box.height.toFixed(0)} card bottom=${(card.y + card.height).toFixed(0)} ${fits && !overflowX ? "OK" : "OVERFLOW"}`,
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
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  // Live public RPC, no mock.
  await shoot(browser, "anchor-match.png", "온체인 앵커 일치");

  // Successful read_anchor with a different head.
  await shoot(browser, "anchor-mismatch.png", "온체인 앵커 불일치", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const value = { head_hash: OTHER_HEAD, count: 5, block_height: 250_000_000, timestamp_ms: Date.now() };
    return route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "consent-guard", result: { result: bytes(value), logs: [], block_height: 250_000_001 } }),
    });
  });

  // RPC unreachable.
  await shoot(browser, "anchor-unavailable.png", "앵커 확인 불가", (route) => route.abort("internetdisconnected"));

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
