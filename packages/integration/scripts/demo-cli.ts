// Offline 5-scene demo: consent proxy + fixture AI + local hash-chain ledger. No network, no keys.
// Run: npm run demo:cli
import { pathToFileURL } from "node:url";
import type { LedgerEvent } from "@consent-guard/policy";
import type { LlmAdapter } from "@consent-guard/proxy";
import type { VerifyResult } from "@consent-guard/ledger/core";
import { createDemoPipeline } from "../src/pipeline.ts";
import { createDemoAdapter, runScenes, SCENE_START } from "../src/scenarios.ts";
import type { SceneRun, StepOutcome } from "../src/scenarios.ts";

const KST_OFFSET_MS = 9 * 60 * 60_000;
const kst = (ms: number): string => `${new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ")} KST`;
const ledgerLine = (e: LedgerEvent): string =>
  `  ledger  #${e.seq} ${e.kind.padEnd(7)} ref=${e.refId} hash=${e.hash.slice(0, 12)}…`;

function formatStep(o: StepOutcome): string[] {
  switch (o.op) {
    case "grant": {
      const g = o.grant;
      const masked = g.maskFields.length > 0 ? ` mask=[${g.maskFields.join(", ")}]` : "";
      return [
        `  동의(grant) ${g.id}: ${g.agentId} → ${g.dataset} allow=[${g.allowFields.join(", ")}]${masked} purposes=[${g.purposes.join(", ")}] 만료 ${kst(g.expiresAt)}`,
        ledgerLine(o.event),
      ];
    }
    case "advance":
      return [`  시계 +${o.ms / 60_000}분 → ${kst(o.now)}`];
    case "revoke":
      return [`  철회(revoke) ${o.grantId} @ ${kst(o.event.at)}`, ledgerLine(o.event)];
    case "request": {
      const { request: r, result } = o;
      const lines = [
        `  요청(request) ${r.id}: ${r.agentId} → ${r.dataset} [${r.fields.join(", ")}] purpose=${r.purpose} @ ${kst(r.at)}`,
        `  결정(decision) ${result.policy.decision.toUpperCase()} — ${result.policy.reason}`,
      ];
      if (result.policy.decision === "allow") {
        lines.push(`  전달(delivered) ${result.delivered.length} rows:`);
        for (const row of result.delivered) lines.push(`    ${JSON.stringify(row)}`);
      } else {
        lines.push("  전달(delivered) 없음 — AI 호출 안 함 / nothing sent, AI not called");
      }
      if (result.ai) lines.push(`  AI [${result.ai.badge}] ${result.ai.text}`);
      lines.push(ledgerLine(result.event));
      return lines;
    }
  }
}

export interface DemoCliResult {
  verify: VerifyResult;
  runs: SceneRun[];
  chain: LedgerEvent[];
}

/** Runs the 5 demo scenes and prints the log through `log`. Ends with "chain verified: OK" when the ledger verifies. */
export async function main(
  log: (line: string) => void = console.log,
  adapter: LlmAdapter = createDemoAdapter(),
): Promise<DemoCliResult> {
  const pipeline = createDemoPipeline({ adapter, now: SCENE_START });
  log(`consent-guard 데모 / demo — 시작 ${kst(SCENE_START)}`);
  let current = "";
  const runs = await runScenes(pipeline, {
    onStep(scene, outcome) {
      if (scene.id !== current) {
        current = scene.id;
        log("");
        log(`=== 장면 ${scene.id}: ${scene.title}`);
      }
      for (const line of formatStep(outcome)) log(line);
    },
  });
  const chain = pipeline.getChain();
  const verify = await pipeline.verify();
  log("");
  log(`ledger: ${chain.length} events, head ${chain.at(-1)?.hash.slice(0, 12) ?? "-"}…`);
  log(verify.ok ? "chain verified: OK" : `chain verified: FAILED at index ${verify.index} (${verify.reason})`);
  return { verify, runs, chain };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { verify } = await main();
  if (!verify.ok) process.exitCode = 1;
}
