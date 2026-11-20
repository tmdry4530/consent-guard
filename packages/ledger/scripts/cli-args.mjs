// Tiny shared flag parsing + the write gate for deploy.mjs / anchor.mjs.
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const [k, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) flags[k] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return flags;
}

export const WRITE_ENV = "CONSENT_GUARD_ALLOW_TESTNET_WRITE";

/** Returns { live, refusal }. Live only with --execute, no --dry-run, and WRITE_ENV=1. */
export function writeGate(flags, env = process.env) {
  if (!flags.execute || flags["dry-run"]) return { live: false, refusal: null };
  if (env[WRITE_ENV] !== "1") return { live: false, refusal: `--execute given but ${WRITE_ENV}=1 is not set; refusing to send` };
  return { live: true, refusal: null };
}

export function printSummary(title, rows) {
  console.log(`\n=== ${title} ===`);
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`${k.padEnd(w)} : ${typeof v === "string" ? v : JSON.stringify(v)}`);
}
