// Browser e2e for the demo flow. Uses the box's system Chrome (no Playwright browser download)
// and a local vite dev server started/stopped by Playwright. No network beyond 127.0.0.1.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const chromeLaunch = {
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
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
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
