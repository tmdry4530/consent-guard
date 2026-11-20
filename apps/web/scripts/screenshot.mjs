// Screenshots of the demo flow at 1280×800, with an AI-panel layout check. Usage:
//   BASE_URL=http://127.0.0.1:4173 node apps/web/scripts/screenshot.mjs
//   OUT_DIR=/tmp/shots node apps/web/scripts/screenshot.mjs   # override output
// Exits 1 if any AI card is clipped by the AI panel or the viewport.
// Needs a running web server at BASE_URL (default preview on 4173).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { resolveChromePath } from "./chromePath.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT_DIR = process.env.OUT_DIR ?? join(repoRoot, "evidence/web-demo");
const VIEWPORT = { width: 1280, height: 800 };
mkdirSync(OUT_DIR, { recursive: true });

const failures = [];

/** All three AI cards must sit fully inside the AI panel and the viewport (no panel scrolling). */
async function checkAiCards(page, label, expectedCards) {
  const panel = await page.getByTestId("ai-responses").boundingBox();
  const cards = page.locator('[data-testid^="ai-card-"]');
  const n = await cards.count();
  const fmt = (b) => `y=${b.y.toFixed(1)} h=${b.height.toFixed(1)} bottom=${(b.y + b.height).toFixed(1)}`;
  console.log(`[${label}] ai-responses panel ${fmt(panel)}`);
  if (n !== expectedCards) failures.push(`${label}: expected ${expectedCards} AI cards, found ${n}`);
  const panelBottom = panel.y + panel.height;
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const id = await card.getAttribute("data-testid");
    const b = await card.boundingBox();
    const bottom = b.y + b.height;
    const ok = bottom <= panelBottom + 0.5 && bottom <= VIEWPORT.height;
    console.log(`[${label}]   ${id} ${fmt(b)} ${ok ? "OK" : "CLIPPED"}`);
    if (!ok) failures.push(`${label}: ${id} bottom ${bottom.toFixed(1)} > panel ${panelBottom.toFixed(1)} / ${VIEWPORT.height}`);
  }
}

const browser = await chromium.launch({
  executablePath: resolveChromePath(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByTestId("request-feed").waitFor();
  await page.getByText("해시 체인 검증 ✓").waitFor();
  await page.getByTestId("demo-clock").getByText("2026-11-20 20:00 KST").waitFor();
  await page.screenshot({ path: join(OUT_DIR, "01-initial.png") });

  await page.getByTestId("approve-req-medical-full").click();
  await page.getByTestId("approve-req-medical-full").waitFor({ state: "detached" });
  await page.getByTestId("ai-card-req-medical-full").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, "02-after-approve-medical.png") });
  await checkAiCards(page, "02", 3);

  await page.getByTestId("advance-clock").click();
  await page.getByTestId("demo-clock").getByText("2026-11-20 20:10 KST").waitFor();
  await page.getByTestId("feed-req-allergy-after-expire").getByText("거부").waitFor();
  await page.getByTestId("grant-list").getByText("만료", { exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, "03-after-plus-10min.png") });
  await checkAiCards(page, "03", 3);

  await page.getByTestId("revoke-grant-card-budget").click();
  await page.getByTestId("feed-req-card-after-revoke").getByText("거부").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, "04-after-revoke.png") });
  await checkAiCards(page, "04", 3);

  console.log(`screenshots written to ${OUT_DIR}`);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`AI panel layout check FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("AI panel layout check passed");
