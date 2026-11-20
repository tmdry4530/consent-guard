// AI answers go through @consent-guard/proxy: policy gate → masked rows → LlmAdapter.
// Only called at the moment a request is decided allow; the answer is stored on the entry as
// history, so later revokes / clock advances never re-run the proxy (which would now deny).
import {
  createConsentProxy,
  createFixtureAdapter,
  type ConsentProxy,
  type LlmAdapter,
  type ProxyAiResult,
} from "@consent-guard/proxy";
import { aiFixtures, sampleData } from "./fixtures";
import { evaluate } from "./policyAdapter";
import type { AppState } from "./state";

/**
 * Proxy with a stateless engine. Replay protection is owned by state.ts (seenRequestIds); the
 * proxy's default createPolicyEngine() keeps its own seen set and would replay-deny a pending
 * request once the user approves it.
 */
export function createAppProxy(adapter: LlmAdapter): ConsentProxy {
  return createConsentProxy({ adapter, engine: { evaluate: (req, grants, now) => evaluate(req, grants, now) } });
}

/** Recorded answers from fixtures/ai-responses.json; never calls a live model. */
export function createFixtureProxy(): ConsentProxy {
  return createAppProxy(createFixtureAdapter(aiFixtures));
}

export type AiOutcome = { ai: ProxyAiResult } | { aiError: string };

/** Ids of allowed requests that have neither an AI answer nor an AI error yet. */
export function awaitingAi(state: AppState): string[] {
  return state.requests
    .filter((e) => e.result.decision === "allow" && !e.ai && e.aiError === undefined)
    .map((e) => e.request.id);
}

/**
 * Run the proxy for the given allowed requests against `state.grants` at decision time `now`.
 * Call right after the allow decision; non-allowed ids are skipped (adapter never called).
 */
export async function fetchAi(
  proxy: ConsentProxy,
  state: AppState,
  ids: readonly string[],
  now: number,
): Promise<Map<string, AiOutcome>> {
  const out = new Map<string, AiOutcome>();
  await Promise.all(
    ids.map(async (id) => {
      const entry = state.requests.find((e) => e.request.id === id);
      if (!entry || entry.result.decision !== "allow") return;
      try {
        const { policy, ai } = await proxy.handle(entry.request, state.grants, sampleData[entry.request.dataset] ?? [], now);
        out.set(id, ai ? { ai } : { aiError: `proxy decision ${policy.decision}: ${policy.reason}` });
      } catch (err) {
        out.set(id, { aiError: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
  return out;
}

/** Merge AI outcomes into the matching entries (by request id). */
export function withAi(state: AppState, outcomes: ReadonlyMap<string, AiOutcome>): AppState {
  if (outcomes.size === 0) return state;
  return {
    ...state,
    requests: state.requests.map((e) => {
      const o = outcomes.get(e.request.id);
      return o ? { ...e, ...o } : e;
    }),
  };
}
