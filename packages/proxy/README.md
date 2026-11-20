# @consent-guard/proxy

Consent gate between user data and an LLM. Every request is evaluated by `@consent-guard/policy` first;
only allowed, masked rows ever reach the model adapter.
Runs as TypeScript directly on Node >= 23.6 (type stripping); no build step.

## API

```ts
import { createConsentProxy, createFixtureAdapter, loadFixtureResponses } from "@consent-guard/proxy";

const adapter = createFixtureAdapter(loadFixtureResponses(json)); // json = fixtures/ai-responses.json content
const proxy = createConsentProxy({ adapter });                    // engine defaults to createPolicyEngine()
const { policy, delivered, ai } = await proxy.handle(req, grants, rows, now);
```

- **allow**: `delivered = applyMask(rows, policy)` (only `passFields` ∪ `maskFields`, masked values `"***"`),
  sliced to `req.maxRows` when set; the adapter receives exactly `delivered`.
  `ai = { text, recorded, source, badge }` with `badge` `"recorded"` or `"live"`.
- **deny / pending**: `delivered = []`, the adapter is not called, no `ai`.
- Replay protection comes from the engine: reusing a request id is denied.
- `createFixtureAdapter` replays recorded answers by request id (`source: "fixture"`, `recorded: true`)
  and throws when no recording exists; it never calls a live model.
- `LlmAdapter` is the interface for any other model backend.

## Scripts

```sh
npm test -w packages/proxy
npx tsc -p packages/proxy/tsconfig.json --noEmit
```
