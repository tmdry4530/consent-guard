// Screenshots of the demo flow. Usage:
//   BASE_URL=http://127.0.0.1:4173 OUT_DIR=/tmp/shots node apps/web/scripts/screenshot.mjs
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "/tmp/c9-video-tools/node_modules/playwright-core/index.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT_DIR = process.env.OUT_DIR ?? "./screenshots";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByTestId("request-feed").waitFor();
  await page.getByText("해시 체인 검증 ✓").waitFor();
  await page.screenshot({ path: join(OUT_DIR, "01-initial.png") });

  await page.getByTestId("approve-req-medical-full").click();
  await page.getByTestId("approve-req-medical-full").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, "02-after-approve-medical.png") });

  await page.getByTestId("revoke-grant-card-budget").click();
  await page.getByTestId("feed-req-card-after-revoke").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, "03-after-revoke-deny.png") });

  const audit = page.getByTestId("audit-log");
  await audit.scrollIntoViewIfNeeded();
  await audit.screenshot({ path: join(OUT_DIR, "04-audit-log.png") });
  console.log(`screenshots written to ${OUT_DIR}`);
} finally {
  await browser.close();
}
