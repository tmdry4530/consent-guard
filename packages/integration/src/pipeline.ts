import type { DataRequest, Grant, LedgerEvent, LedgerEventKind } from "@consent-guard/policy";
import { createConsentProxy } from "@consent-guard/proxy";
import type { LlmAdapter, ProxyResult } from "@consent-guard/proxy";
import { appendToChain, verifyChain } from "@consent-guard/ledger/core";
import type { LedgerEventInput, VerifyResult } from "@consent-guard/ledger/core";

/** 2026-11-20 20:00 KST (11:00 UTC); same value as fixtures/demo.json `clock.now`. */
export const DEMO_START = Date.UTC(2026, 10, 20, 11, 0, 0);

export interface DemoPipelineOptions {
  adapter: LlmAdapter;
  /** Grants already in force before the demo starts; not written to the ledger. Copied, never mutated. */
  grants?: readonly Grant[];
  /** Initial demo clock (epoch ms). Defaults to DEMO_START. */
  now?: number;
}

export interface PipelineRequestResult extends ProxyResult {
  event: LedgerEvent;
}

export interface DemoPipeline {
  /** Evaluate through the consent proxy at the demo clock, then log access/deny/pending. */
  request(req: DataRequest, rows: Record<string, unknown>[]): Promise<PipelineRequestResult>;
  /** Add a grant and log kind "grant". */
  grant(g: Grant): Promise<LedgerEvent>;
  /** Set revokedAt on the grant (default: demo clock) and log kind "revoke". */
  revoke(grantId: string, at?: number): Promise<LedgerEvent>;
  now(): number;
  setNow(ms: number): void;
  advance(ms: number): number;
  getGrants(): Grant[];
  getChain(): LedgerEvent[];
  verify(): Promise<VerifyResult>;
}

const DECISION_KIND: Record<ProxyResult["policy"]["decision"], LedgerEventKind> = {
  allow: "access",
  deny: "deny",
  pending: "pending",
};

/**
 * In-memory demo wiring: consent proxy (policy + masking + LLM adapter) in front, sha256 hash-chain
 * ledger behind. Calls must be awaited one at a time; the ledger is local only (no anchoring).
 */
export function createDemoPipeline({ adapter, grants = [], now = DEMO_START }: DemoPipelineOptions): DemoPipeline {
  const proxy = createConsentProxy({ adapter });
  const live: Grant[] = structuredClone([...grants]);
  let chain: LedgerEvent[] = [];
  let clock = now;

  async function log(input: LedgerEventInput): Promise<LedgerEvent> {
    chain = await appendToChain(chain, input);
    return structuredClone(chain[chain.length - 1]!);
  }

  return {
    async request(req, rows) {
      const result = await proxy.handle(req, live, rows, clock);
      const { policy } = result;
      const fields = policy.decision === "allow" ? [...policy.passFields, ...policy.maskFields] : [...req.fields];
      const event = await log({
        kind: DECISION_KIND[policy.decision],
        at: clock,
        agentId: req.agentId,
        dataset: req.dataset,
        fields,
        refId: req.id,
      });
      return { ...result, event };
    },

    async grant(g) {
      if (live.some((x) => x.id === g.id)) throw new Error(`Grant ${g.id} already exists.`);
      const copy = structuredClone(g);
      live.push(copy);
      return log({
        kind: "grant",
        at: clock,
        agentId: copy.agentId,
        dataset: copy.dataset,
        fields: [...copy.allowFields, ...copy.maskFields],
        refId: copy.id,
      });
    },

    async revoke(grantId, at = clock) {
      const g = live.find((x) => x.id === grantId);
      if (!g) throw new Error(`Unknown grant ${grantId}.`);
      g.revokedAt = at;
      return log({
        kind: "revoke",
        at,
        agentId: g.agentId,
        dataset: g.dataset,
        fields: [...g.allowFields, ...g.maskFields],
        refId: g.id,
      });
    },

    now: () => clock,
    setNow(ms) {
      clock = ms;
    },
    advance(ms) {
      clock += ms;
      return clock;
    },
    getGrants: () => structuredClone(live),
    getChain: () => structuredClone(chain),
    verify: () => verifyChain(chain),
  };
}
