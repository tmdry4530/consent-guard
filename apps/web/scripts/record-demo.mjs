// Records the 5-scene demo as a 1280×800 webm with readable pauses, then extracts evidence frames.
// Usage (from apps/web): npm run demo:video
//   PORT=4174 SCENE_PAUSE_MS=11000 EVIDENCE_DIR=/path node scripts/record-demo.mjs
// Starts its own vite dev server (127.0.0.1 only) and kills exactly that PID when done.
// Offline: the NEAR RPC read_anchor call is mocked (match) before goto, same helper as the e2e spec.
//
// Capture is CDP screencast → system ffmpeg, not Playwright recordVideo: the latter needs
// Playwright's own ffmpeg build, which would mean a download.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { mockAnchorRpc, waitForAnchorStatus } from "../e2e/anchorMock.ts";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webDir, "../..");
const PORT = Number(process.env.PORT ?? 4174);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PAUSE = Number(process.env.SCENE_PAUSE_MS ?? 11_000);
const VIEWPORT = { width: 1280, height: 800 };
const FPS = 10;
const OUT = join(repoRoot, "demo/video/consent-guard-demo.webm");
const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? resolve(repoRoot, "../evidence/dev2-e2e");
const MAX_BYTES = 20 * 1024 * 1024;

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

/**
 * Constant-frame-rate recorder: the screencast only emits frames on repaint, so a wall-clock
 * ticker re-writes the latest frame until frame count matches elapsed time × FPS.
 */
async function startRecorder(page, mjpegPath) {
  const out = createWriteStream(mjpegPath);
  const cdp = await page.context().newCDPSession(page);
  let latest = null;
  let t0 = 0;
  let written = 0;
  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    latest = Buffer.from(data, "base64");
    if (t0 === 0) t0 = Date.now();
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  const flush = () => {
    if (!latest) return;
    const due = Math.floor(((Date.now() - t0) / 1000) * FPS) + 1;
    for (; written < due; written++) out.write(latest);
  };
  const timer = setInterval(flush, 1000 / FPS / 2);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  });
  return {
    /** Seconds since the first captured frame = position in the output video. */
    elapsed: () => (t0 === 0 ? 0 : (Date.now() - t0) / 1000),
    async stop() {
      flush();
      clearInterval(timer);
      await cdp.send("Page.stopScreencast");
      await new Promise((r) => out.end(r));
    },
  };
}

const vite = spawn(join(repoRoot, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: webDir,
  stdio: ["ignore", "ignore", "inherit"],
});
const tmp = mkdtempSync(join(tmpdir(), "cg-demo-video-"));
let browser;

try {
  await waitForServer(BASE_URL, 60_000);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await mockAnchorRpc(page, "match");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByTestId("chain-status").getByText("해시 체인 검증 ✓").waitFor();
  await page.getByTestId("ai-card-req-card-budget").locator(".badge").getByText("recorded").waitFor();
  await waitForAnchorStatus(page, "match");

  const mjpeg = join(tmp, "capture.mjpeg");
  const rec = await startRecorder(page, mjpeg);
  /** Scene name -> [start, end] seconds into the video, for frame extraction. */
  const marks = [];
  const hold = async (name) => {
    await page.waitForTimeout(500); // let the repaint land before marking
    const start = rec.elapsed();
    await page.waitForTimeout(PAUSE);
    marks.push({ name, start, end: rec.elapsed() });
    console.log(`scene ${name}: ${start.toFixed(1)}s–${rec.elapsed().toFixed(1)}s`);
  };
  /** Hover so the target is in view, give the viewer a beat, then click. */
  const press = async (testId) => {
    const el = page.getByTestId(testId);
    await el.scrollIntoViewIfNeeded();
    await el.hover();
    await page.waitForTimeout(1200);
    await el.click();
  };
  const badge = (id) => page.getByTestId(`feed-${id}`).locator(".badge");

  await hold("01-initial");

  await page.getByTestId("feed-req-account-raw").scrollIntoViewIfNeeded();
  await badge("req-account-raw").getByText("거부").waitFor();
  await hold("02-deny-raw");

  await press("approve-req-medical-full");
  await page.getByTestId("ai-card-req-medical-full").locator(".badge").getByText("recorded").waitFor();
  await hold("03-approve-medical");

  await press("advance-clock");
  await page.getByTestId("demo-clock").getByText("2026-11-20 20:10 KST").waitFor();
  await badge("req-allergy-after-expire").getByText("거부").waitFor();
  await hold("04-plus-10min");

  await press("revoke-grant-card-budget");
  await badge("req-card-after-revoke").getByText("거부").waitFor();
  await page.getByTestId("chain-status").getByText("해시 체인 검증 ✓").waitFor();
  await waitForAnchorStatus(page, "match");
  await hold("05-revoke");

  await rec.stop();
  await browser.close();
  browser = undefined;

  mkdirSync(dirname(OUT), { recursive: true });
  const encode = (crf) =>
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "mjpeg", "-framerate", String(FPS), "-i", mjpeg,
      "-vf", `scale=${VIEWPORT.width}:${VIEWPORT.height}`,
      "-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-pix_fmt", "yuv420p",
      "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
      OUT,
    ]);
  encode(32);
  const firstBytes = statSync(OUT).size;
  if (firstBytes > MAX_BYTES) {
    encode(45);
    console.log(`first encode ${firstBytes} bytes > 20MB, re-encoded at higher CRF`);
  }
  const duration = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT])
    .toString()
    .trim();
  console.log(`video: ${OUT}`);
  console.log(`size: ${statSync(OUT).size} bytes`);
  console.log(`duration: ${duration}s`);

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const m of marks) {
    const at = ((m.start + m.end) / 2).toFixed(2);
    const png = join(EVIDENCE_DIR, `${m.name}.png`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", at, "-i", OUT, "-frames:v", "1", png]);
    console.log(`frame ${png} @ ${at}s`);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  rmSync(tmp, { recursive: true, force: true });
}
