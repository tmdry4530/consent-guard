// Static server for the verify page. Serves packages/ledger/ so verify/ can import ../src/core.js.
// Usage: node scripts/serve-verify.mjs [--port 4173] [--host 127.0.0.1]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export function startServer({ port = 4173, host = "127.0.0.1" } = {}) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (pathname === "/" || pathname === "/verify") {
      res.writeHead(302, { location: "/verify/" }).end();
      return;
    }
    let file = normalize(join(ROOT, pathname));
    if (!file.startsWith(ROOT) || file.split(sep).includes("node_modules") || file.split(sep).includes("target")) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : def;
  };
  const port = Number(arg("--port", process.env.PORT ?? 4173));
  const host = arg("--host", "127.0.0.1");
  await startServer({ port, host });
  console.log(`verify page: http://${host}:${port}/verify/`);
}
