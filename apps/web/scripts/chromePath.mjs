// System Chrome/Chromium for Playwright (no browser download): CHROME_PATH, else the first common Linux path.
import { existsSync } from "node:fs";

const CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-unstable",
];

export function resolveChromePath() {
  const env = process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const found = CANDIDATES.find((p) => existsSync(p));
  if (found) return found;
  throw new Error(
    `Chrome/Chromium not found${env ? ` (CHROME_PATH=${env} does not exist)` : ""}; tried ${CANDIDATES.join(", ")}. ` +
      "Install Chrome or Chromium, or set CHROME_PATH to the browser executable.",
  );
}
