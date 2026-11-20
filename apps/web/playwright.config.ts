// Browser e2e for the demo flow. Uses a system Chrome/Chromium (CHROME_PATH or a common path; no Playwright
// browser download) and a local vite dev server started/stopped by Playwright. No network beyond 127.0.0.1.
import { defineConfig } from "@playwright/test";
import { resolveChromePath } from "./scripts/chromePath.mjs";

// 4174: keep 4173 free for `verify:serve` / `vite preview`. strictPort + reuseExistingServer:false
// fail fast if 4174 is already taken (do not attach to some other server).
const PORT = Number(process.env.E2E_PORT ?? 4174);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const chromeLaunch = {
  executablePath: resolveChromePath(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    launchOptions: chromeLaunch,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
