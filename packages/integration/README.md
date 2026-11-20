# @consent-guard/integration

End-to-end demo wiring: consent proxy (policy + masking + recorded AI) in front of a local sha256 hash-chain ledger.
Runs as TypeScript directly on Node >= 23.6; no build step, no network, no API keys, no NEAR transactions (the ledger is never anchored here).

## API

```ts
import { createDemoPipeline, createDemoAdapter, runScenes, SCENE_START } from "@consent-guard/integration";

const pipeline = createDemoPipeline({ adapter: createDemoAdapter(), grants: [], now: SCENE_START });
await pipeline.grant(g);              // ledger kind "grant"
await pipeline.request(req, rows);    // proxy.handle at the demo clock, then "access" | "deny" | "pending"
await pipeline.revoke(grantId, at?);  // sets revokedAt, ledger kind "revoke"
pipeline.setNow(ms); pipeline.advance(ms);
pipeline.getChain(); await pipeline.verify();  // verifyChain -> { ok } | { ok: false, index, reason }
```

- Ledger `refId` is the request id (access/deny/pending) or the grant id (grant/revoke).
  `fields` are passFields + maskFields on access, the requested fields otherwise, allowFields + maskFields for grant/revoke.
- `grants` passed at creation are copied and not logged; use `grant()` to log one.
- Calls must be awaited one at a time.

## Scenes (`src/scenarios.ts`, data from `fixtures/`)

Clock starts at 2026-11-20 20:00 KST (`fixtures/demo.json` `clock.now`).

1. `grant-card-budget`, then `req-card-budget` -> allow; `merchant` delivered as `***`.
2. `req-account-raw` (`account_number`) -> deny.
3. `req-medical-full` -> pending (sensitive dataset, no grant).
4. `grant-allergy-diet` (10 min), `req-allergy-diet` -> allow; +11 min, `req-allergy-diet-expired` -> deny (expired).
5. revoke `grant-card-budget`, `req-card-after-revoke` -> deny; the AI adapter is not called.

AI text comes from `fixtures/ai-responses.json` via the proxy's fixture adapter (`[recorded]` badge).

## Scripts

- `npm run demo:cli` (repo root): prints the scenes and ends with `chain verified: OK`.
- `npm test -w @consent-guard/integration`: end-to-end scenes, leak checks, adapter call counts, ledger tamper detection.
