import { applyMask, createPolicyEngine } from "@consent-guard/policy";
import type { DataRequest, Grant, PolicyEngine, PolicyResult } from "@consent-guard/policy";
import type { LlmAdapter } from "./adapter.ts";

export interface ProxyAiResult {
  text: string;
  recorded: boolean;
  source: string;
  badge: "recorded" | "live";
}

export interface ProxyResult {
  policy: PolicyResult;
  delivered: Record<string, unknown>[];
  ai?: ProxyAiResult;
}

export interface ConsentProxyOptions {
  adapter: LlmAdapter;
  /** Defaults to createPolicyEngine() (with its own replay-protection state). */
  engine?: PolicyEngine;
}

export interface ConsentProxy {
  handle(req: DataRequest, grants: Grant[], rows: Record<string, unknown>[], now: number): Promise<ProxyResult>;
}

/**
 * Gate between user data and an LLM: evaluate the request, and only on allow send the
 * masked rows (passFields ∪ maskFields, masked values "***", at most req.maxRows) to the adapter.
 */
export function createConsentProxy({ adapter, engine = createPolicyEngine() }: ConsentProxyOptions): ConsentProxy {
  return {
    async handle(req, grants, rows, now) {
      const policy = engine.evaluate(req, grants, now);
      if (policy.decision !== "allow") return { policy, delivered: [] };

      const masked = applyMask(rows, policy);
      const delivered = req.maxRows !== undefined ? masked.slice(0, Math.max(0, req.maxRows)) : masked;
      const out = await adapter.complete({
        requestId: req.id,
        agentId: req.agentId,
        purpose: req.purpose,
        data: delivered,
      });
      return {
        policy,
        delivered,
        ai: {
          text: out.text,
          recorded: out.recorded,
          source: out.source,
          badge: out.recorded ? "recorded" : "live",
        },
      };
    },
  };
}
