import { spawn } from "node:child_process";
import { redact } from "./redact.mjs";

export function runNear(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("near", args, { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => { out += b.toString("utf8"); });
    child.stderr.on("data", (b) => { err += b.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err, text: redact((out || "") + (err ? `\n${err}` : "")) }));
  });
}

/** Extract a 43-44 char base58 tx hash if the CLI printed one. */
export function extractTxHash(text) {
  const m = String(text).match(/\b([A-Za-z0-9]{43,44})\b/g);
  if (!m) return null;
  // Prefer a token that appears near 'transaction' wording
  const lines = String(text).split(/\n/);
  for (const line of lines) {
    if (/transaction|tx.hash|signed transaction has been sent|Open the transaction/i.test(line)) {
      const h = line.match(/\b([1-9A-HJ-NP-Za-km-z]{43,44})\b/);
      if (h) return h[1];
    }
  }
  // fallback: last 43-44 char token
  return m.at(-1);
}
