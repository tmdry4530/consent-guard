# @consent-guard/policy

Pure policy engine: decides whether an AI agent may read a dataset, and which fields pass raw or masked.
Runs as TypeScript directly on Node >= 23.6 (type stripping); no build step.

## API

```ts
import { evaluate, createPolicyEngine, applyMask } from "@consent-guard/policy";

evaluate(req, grants, now, { seenRequestIds? }): PolicyResult
createPolicyEngine().evaluate(req, grants, now)   // keeps its own seen-id set (replay protection)
applyMask(rows, result)                            // keep passFields + maskFields, masked values -> "***"
```

- `evaluate` is pure, except that when `seenRequestIds` is given it checks `req.id` and then adds it (denied ids are burned too).
- `applyMask` returns `[]` unless `result.decision === "allow"`.
- Constants: `SENSITIVE_DATASETS` (`medical_record`, `location`), `FORBIDDEN_RAW_FIELDS` (`account_number`, `card_number`, `resident_id`, ...), `MASK` (`"***"`).
- Types (`DataRequest`, `Grant`, `PolicyResult`, ...) live in `src/types.ts`, the shared contract.

## Rules (first match wins)

1. **Replay**: request id already seen -> deny.
2. **Forbidden raw field** requested (`FORBIDDEN_RAW_FIELDS`) -> deny, regardless of grants.
3. Matching grants = same `agentId` and `dataset`.
4. **Revoked**: every matching grant has `revokedAt <= now` -> deny.
5. **Expired**: every non-revoked grant has `expiresAt <= now` -> deny.
6. **No grant**: sensitive dataset -> pending (owner approval); otherwise deny.
7. **Purpose**: no usable grant lists `req.purpose` -> deny.
8. **Limits**: `rangeDays > maxRangeDays` or `maxRows > grant.maxRows` -> deny (names the limit). Limits missing on either side are not checked.
9. **Fields**: any requested field outside `allowFields` + `maskFields` -> deny, listing them.
   `maskFields` = requested ∩ grant.maskFields; `passFields` = requested ∩ allowFields minus maskFields.
10. **Allow** with `grantId`.

Deny/pending results have empty `passFields`/`maskFields` and carry `grantId` when a grant was involved.
Every result has a Korean `reason` meant for display (e.g. `grant-card-budget 권한으로 허용(가림: merchant)`, `diet-agent/medical_record: grant-allergy-diet 권한이 만료됨`, `이미 처리된 요청 id(재요청 차단): req-x`).

## Scripts

```sh
npm test -w packages/policy
npx tsc -p packages/policy/tsconfig.json --noEmit
```
