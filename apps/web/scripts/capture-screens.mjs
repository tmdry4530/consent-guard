// Captures the 5 demo scenes as 1280×800 PNG slides into <repoRoot>/demo/screens/.
// Usage (from apps/web): npm run demo:screens
//   PORT=4175 OUT_DIR=/path node scripts/capture-screens.mjs
//   DEMO_REAL_RPC=1 node scripts/capture-screens.mjs   # read_anchor hits the real public NEAR testnet RPC
// Starts its own vite dev server (127.0.0.1 only) and kills exactly that PID when done.
// Default is offline: read_anchor is mocked (final demo head) before goto, same helper as the e2e spec.
// PNGs are written to a temp dir and copied into OUT_DIR only after all 5 scenes passed their checks
// (including the scene-5 anchor "match"), so a failed run never overwrites the committed slides.
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { RPC_URL, mockAnchorRpc, readAnchorStatus, waitForAnchorStatus } from "../e2e/anchorMock.ts";
import { resolveChromePath } from "./chromePath.mjs";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webDir, "../..");
const PORT = Number(process.env.PORT ?? 4175);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };
const OUT_DIR = resolve(process.env.OUT_DIR ?? join(repoRoot, "demo/screens"));
const REAL_RPC = process.env.DEMO_REAL_RPC === "1";
const TIMEOUT_MS = 15_000;

/** Like waitForAnchorStatus, but the error names what the panel actually shows. */
async function expectAnchor(page, kind) {
  try {
    await waitForAnchorStatus(page, kind);
  } catch (e) {
    const now = await readAnchorStatus(page).catch(() => ({ kind: "?", label: "?" }));
    throw new Error(
      `anchor panel expected data-kind="${kind}" (${REAL_RPC ? "real RPC" : "mocked RPC"}), ` +
        `got data-kind="${now.kind}" label="${now.label}": ${e.message.split("\n")[0]}`,
    );
  }
}

/** Polls until the locator's text satisfies `test` (string = substring, RegExp = match). */
async function expectText(locator, test, what) {
  const ok = (t) => (typeof test === "string" ? t.includes(test) : test.test(t));
  const end = Date.now() + TIMEOUT_MS;
  let last = "";
  while (Date.now() < end) {
    last = (await locator.textContent({ timeout: TIMEOUT_MS }).catch(() => null)) ?? "";
    if (ok(last.trim())) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${what}: expected ${test} but got "${last.trim()}"`);
}

async function expectCount(locator, n, what) {
  const end = Date.now() + TIMEOUT_MS;
  let c = -1;
  while (Date.now() < end) {
    if ((c = await locator.count()) === n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${what}: expected count ${n}, got ${c}`);
}

/** Fails unless the PNG's IHDR says exactly 1280×800. */
function assertPngSize(path) {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(24);
  try {
    readSync(fd, buf, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${path}: not a PNG`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== VIEWPORT.width || h !== VIEWPORT.height) throw new Error(`${path}: ${w}×${h}, expected 1280×800`);
}

async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not come up at ${url}`);
}

// Slide-only emphasis for scene 2 (raw account deny). Injected at screenshot time, removed right after,
// so the other scenes render exactly as the app does.
const HIGHLIGHT_CSS = `
  [data-testid="request-feed"] li.item:not([data-cg-hl]) { opacity: 0.35; filter: blur(0.6px); }
  [data-cg-hl] { position: relative; z-index: 2; }
  li[data-cg-hl] {
    outline: 3px solid #e5484d; outline-offset: 2px; border-radius: 8px;
    box-shadow: 0 0 0 6px rgba(229, 72, 77, 0.25), 0 0 24px 6px rgba(229, 72, 77, 0.45);
  }
  tr[data-cg-hl] > td { background: rgba(229, 72, 77, 0.16); }
  tr[data-cg-hl] { outline: 2px solid #e5484d; outline-offset: -2px; }
  #cg-hl-callout {
    position: fixed; z-index: 1000; pointer-events: none;
    padding: 4px 12px; border-radius: 999px; background: #e5484d; color: #fff;
    font: 700 14px/1.4 system-ui, sans-serif; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); white-space: nowrap;
  }
`;

async function withDenyHighlight(page, fn) {
  const style = await page.addStyleTag({ content: HIGHLIGHT_CSS });
  try {
    await page.evaluate(() => {
      const feed = document.querySelector('[data-testid="feed-req-account-raw"]');
      if (!feed) throw new Error("feed-req-account-raw not found");
      const row = [...document.querySelectorAll('[data-testid="audit-log"] tbody tr')].find((tr) => {
        const td = tr.querySelectorAll("td");
        return tr.querySelector(".kind.deny") && td[3]?.textContent === "tax-agent" && td[4]?.textContent === "bank_account";
      });
      if (!row) throw new Error("audit deny row (tax-agent / bank_account) not found");
      feed.setAttribute("data-cg-hl", "");
      row.setAttribute("data-cg-hl", "");
      const r = feed.getBoundingClientRect();
      const callout = document.createElement("div");
      callout.id = "cg-hl-callout";
      callout.textContent = "원문 거부";
      document.body.append(callout);
      callout.style.left = `${Math.round(r.right - callout.offsetWidth - 8)}px`;
      callout.style.top = `${Math.round(r.top - callout.offsetHeight / 2 - 2)}px`;
    });
    await fn();
  } finally {
    await page.evaluate(() => {
      document.getElementById("cg-hl-callout")?.remove();
      for (const el of document.querySelectorAll("[data-cg-hl]")) el.removeAttribute("data-cg-hl");
    });
    await style.evaluate((el) => el.remove());
  }
}

const vite = spawn(join(repoRoot, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: webDir,
  stdio: ["ignore", "ignore", "inherit"],
});
const tmp = mkdtempSync(join(tmpdir(), "cg-demo-screens-"));
let browser;

try {
  await waitForServer(BASE_URL, 60_000);
  browser = await chromium.launch({
    executablePath: resolveChromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  if (REAL_RPC) {
    console.log(`anchor: real public RPC ${RPC_URL} (no mock)`);
  } else {
    const anchor = await mockAnchorRpc(page, "match");
    console.log(`anchor: mocked ${anchor.head}/${anchor.count} (${anchor.source})`);
  }
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const byId = (id) => page.getByTestId(id);
  const badge = (id) => byId(`feed-${id}`).locator(".badge");
  const aiCards = () => page.locator('[data-testid^="ai-card-"]');
  const shots = [];
  const shoot = async (name) => {
    await page.mouse.move(0, 0); // no hover highlight in the slide
    await page.waitForTimeout(400); // let the repaint land
    const path = join(tmp, `${name}.png`);
    await page.screenshot({ path, fullPage: false });
    assertPngSize(path);
    shots.push(name);
    console.log(`scene ${name}: ok`);
  };

  // 1. initial feed
  await expectText(byId("demo-clock"), "2026-11-20 20:00 KST", "clock");
  await expectText(badge("req-card-budget"), "허용", "card badge");
  await expectText(badge("req-allergy-diet"), "허용", "diet badge");
  await expectText(badge("req-medical-full"), "대기", "medical badge");
  await expectText(badge("req-account-raw"), "거부", "account badge");
  await expectText(byId("feed-req-account-raw"), "원문 금지 필드 요청: account_number", "account reason");
  await expectText(byId("released-data").locator("td.masked").first(), "***", "masked merchant");
  for (const id of ["req-card-budget", "req-allergy-diet"])
    await expectText(byId(`ai-card-${id}`).locator(".badge"), "recorded", `ai card ${id}`);
  await expectCount(aiCards(), 2, "ai cards");
  await expectText(byId("chain-status"), "해시 체인 검증 ✓", "chain");
  await expectAnchor(page, "before");
  await expectText(byId("anchor-label"), /11건 중 \d+건 · 앵커 전/, "anchor label");
  console.log(`anchor after load: ${JSON.stringify(await readAnchorStatus(page))}`);
  await shoot("01-initial");

  // 2. raw account deny in frame
  await byId("feed-req-account-raw").scrollIntoViewIfNeeded();
  await expectText(badge("req-account-raw"), "거부", "account badge");
  await withDenyHighlight(page, () => shoot("02-deny-raw"));

  // 3. approve medical
  await byId("approve-req-medical-full").scrollIntoViewIfNeeded();
  await byId("approve-req-medical-full").click();
  await expectText(badge("req-medical-full"), "허용", "medical badge");
  await expectText(byId("feed-req-medical-full"), "사용자 승인", "medical reason");
  await expectText(byId("ai-card-req-medical-full").locator(".badge"), "recorded", "medical ai card");
  await expectCount(aiCards(), 3, "ai cards");
  await expectText(byId("approval-queue"), "대기 중인 요청 없음", "approval queue");
  await expectCount(byId("approve-req-medical-full"), 0, "approve button");
  await byId("feed-req-medical-full").scrollIntoViewIfNeeded();
  await shoot("03-approve-medical");

  // 4. +10 min: diet grant expires
  await byId("advance-clock").scrollIntoViewIfNeeded();
  await byId("advance-clock").click();
  await expectText(byId("demo-clock"), "2026-11-20 20:10 KST", "clock");
  const dietGrant = byId("grant-list").locator("li", { hasText: "diet-agent" });
  await expectText(dietGrant.locator(".badge"), "만료", "diet grant");
  await expectCount(byId("revoke-grant-allergy-diet"), 0, "diet revoke button");
  await expectText(badge("req-allergy-after-expire"), "거부", "allergy follow-up badge");
  await expectText(byId("feed-req-allergy-after-expire"), "권한이 만료됨", "allergy follow-up reason");
  await byId("feed-req-allergy-after-expire").scrollIntoViewIfNeeded();
  await shoot("04-plus-10min");

  // 5. revoke card grant; anchor panel must read match
  await byId("revoke-grant-card-budget").scrollIntoViewIfNeeded();
  await byId("revoke-grant-card-budget").click();
  await expectText(badge("req-card-after-revoke"), "거부", "card follow-up badge");
  await expectText(byId("feed-req-card-after-revoke"), "권한이 철회됨", "card follow-up reason");
  const cardGrant = byId("grant-list").locator("li", { hasText: "budget-agent" });
  await expectText(cardGrant.locator(".badge"), "철회됨", "card grant");
  await expectText(byId("chain-status"), "해시 체인 검증 ✓", "chain");
  await expectAnchor(page, "match");
  await byId("anchor-status").scrollIntoViewIfNeeded();
  await expectText(byId("anchor-label"), "현재 장부 = 온체인 앵커 일치 ✓", "anchor label");
  if (!(await byId("anchor-status").isVisible())) throw new Error("anchor panel not visible for scene 5");
  console.log(`anchor at end: ${JSON.stringify(await readAnchorStatus(page))}`);
  await shoot("05-revoke");

  await browser.close();
  browser = undefined;

  // All 5 passed: publish.
  mkdirSync(OUT_DIR, { recursive: true });
  for (const name of shots) {
    const out = join(OUT_DIR, `${name}.png`);
    copyFileSync(join(tmp, `${name}.png`), out);
    assertPngSize(out);
    console.log(`${out}  ${statSync(out).size} bytes  1280×800`);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  rmSync(tmp, { recursive: true, force: true });
}
