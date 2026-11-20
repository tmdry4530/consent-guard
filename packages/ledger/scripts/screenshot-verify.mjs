// Evidence screenshots of the verify page: pasted matching anchor (GREEN) and mismatched anchor (RED).
// Uses playwright-core from /tmp/c9-video-tools (not a dependency) and system Chrome. No network beyond localhost.
// Env: PLAYWRIGHT_CORE (module path), CHROME_PATH, OUT_DIR.
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer } from "./serve-verify.mjs";

const pwPath = process.env.PLAYWRIGHT_CORE ?? "/tmp/c9-video-tools/node_modules/playwright-core/index.mjs";
const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const outDir = process.env.OUT_DIR ?? "/workspace/company/dev3-logs/nesa-ledger-evidence";

// Dynamic on purpose: playwright-core lives outside this repo at a runtime-configured path.
const { chromium } = await import(pathToFileURL(pwPath).href);
const fixture = JSON.parse(await readFile(new URL("../verify/fixtures/sample-chain.json", import.meta.url), "utf8"));
const head = fixture.at(-1).hash;

await mkdir(outDir, { recursive: true });
const server = await startServer({ port: 0 });
const { port } = server.address();
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.goto(`http://127.0.0.1:${port}/verify/`);
  await page.click("#load-sample");
  await page.waitForFunction(() => document.getElementById("events").value.length > 0);

  for (const [name, pasted, want] of [
    ["verify-green.png", head, "green"],
    ["verify-red.png", "0x" + "ab".repeat(32), "red"],
  ]) {
    await page.fill("#pasted", pasted);
    await page.check('input[name="source"][value="pasted"]');
    await page.click("#verify");
    await page.waitForSelector(`#result.${want}`);
    const file = join(outDir, name);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${want.toUpperCase()}: ${(await page.textContent("#result")).trim()}\n  -> ${file}`);
  }
} finally {
  await browser.close();
  server.close();
}
