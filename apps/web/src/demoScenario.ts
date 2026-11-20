// The canonical 5-scene demo, as pure data + the same state transitions App.tsx runs on clicks.
// The demo clock is frozen (fixtures/demo.json clock.now), so playing every step yields the same
// ledger and therefore the same head hash every time. That final head is what is anchored on testnet.
import type { DataRequest, Grant, LedgerEvent } from "@consent-guard/policy";
import { append, type LedgerInput } from "@consent-guard/ledger/adapter";
import { NOW, TEN_MIN, loadDemo, type DemoFixtures } from "./fixtures";
import { advanceDemoClock, approvePending, initialState, revokeGrant, type AppState, type Transition } from "./state";

/** Follow-up request the agent sends once grant `g` is revoked (same rule App.tsx uses on 철회). */
export function followUpFor(afterRevoke: Record<string, DataRequest>, g: Grant): DataRequest | undefined {
  return (
    afterRevoke[g.id] ??
    (g.dataset === "card_tx" && g.purposes.includes("budgeting") ? afterRevoke["grant-card-budget"] : undefined)
  );
}

/** User actions after the initial load, in demo order (scenes 3–5; scenes 1–2 are the initial feed). */
export type DemoStep =
  | { scene: 3; action: "approve"; requestId: string }
  | { scene: 4; action: "advance-clock" }
  | { scene: 5; action: "revoke"; grantId: string };

export const DEMO_STEPS: readonly DemoStep[] = [
  { scene: 3, action: "approve", requestId: "req-medical-full" },
  { scene: 4, action: "advance-clock" },
  { scene: 5, action: "revoke", grantId: "grant-card-budget" },
];

export interface DemoSnapshot {
  /** "initial" (scenes 1–2) or the scene whose step was just applied. */
  after: "initial" | DemoStep["scene"];
  state: AppState;
  ledger: LedgerEvent[];
  now: number;
}

function step(s: DemoStep, state: AppState, now: number, demo: DemoFixtures): { t: Transition; now: number } {
  switch (s.action) {
    case "approve":
      return { t: approvePending(state, s.requestId, now), now };
    case "advance-clock": {
      const next = now + TEN_MIN;
      return { t: advanceDemoClock(state, next, demo.afterExpire), now: next };
    }
    case "revoke": {
      const g = state.grants.find((x) => x.id === s.grantId);
      return { t: revokeGrant(state, s.grantId, now, g && followUpFor(demo.afterRevoke, g)), now };
    }
  }
}

/** Plays the whole demo; returns the initial snapshot followed by one per step. */
export async function runDemoScenario(steps: readonly DemoStep[] = DEMO_STEPS): Promise<DemoSnapshot[]> {
  const demo = loadDemo();
  const seed = initialState(demo.grants, demo.requests, NOW);
  let now = NOW;
  let state = seed.state;
  let ledger = await append([], seed.events as LedgerInput[]);
  const out: DemoSnapshot[] = [{ after: "initial", state, ledger, now }];
  for (const s of steps) {
    const r = step(s, state, now, demo);
    now = r.now;
    state = r.t.state;
    ledger = await append(ledger, r.t.events);
    out.push({ after: s.scene, state, ledger, now });
  }
  return out;
}
