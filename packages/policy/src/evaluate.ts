import type { DataRequest, Grant, PolicyResult } from "./types.ts";

/** Datasets that need explicit owner approval when no usable grant exists. */
export const SENSITIVE_DATASETS: readonly string[] = ["medical_record", "location"];

/** Fields that are never released raw, whatever the grants say. */
export const FORBIDDEN_RAW_FIELDS: readonly string[] = [
  "account_number",
  "card_number",
  "resident_id",
  "ssn",
  "cvv",
  "password",
];

export interface EvaluateOptions {
  /** Request ids already evaluated. When given, req.id is checked and then added. */
  seenRequestIds?: Set<string>;
}

const list = (xs: readonly string[]): string => xs.join(", ");

function refuse(
  decision: "deny" | "pending",
  req: DataRequest,
  reason: string,
  grantId?: string,
): PolicyResult {
  const result: PolicyResult = { decision, requestId: req.id, passFields: [], maskFields: [], reason };
  if (grantId !== undefined) result.grantId = grantId;
  return result;
}

/**
 * Decide whether `req` may read data under `grants` at time `now` (epoch ms).
 * Rules run in a fixed order; the first match wins (see README).
 * Pure, except that opts.seenRequestIds is checked and then updated with req.id.
 */
export function evaluate(
  req: DataRequest,
  grants: Grant[],
  now: number,
  opts?: EvaluateOptions,
): PolicyResult {
  // 1. Replay protection.
  const seen = opts?.seenRequestIds;
  if (seen) {
    if (seen.has(req.id)) {
      return refuse("deny", req, `이미 처리된 요청 id(재요청 차단): ${req.id}`);
    }
    seen.add(req.id);
  }

  const fields = [...new Set(req.fields)];

  // 2. Forbidden raw fields, regardless of grants.
  const forbidden = fields.filter((f) => FORBIDDEN_RAW_FIELDS.includes(f));
  if (forbidden.length > 0) {
    return refuse("deny", req, `원문 금지 필드 요청: ${list(forbidden)}`);
  }

  // 3. Grants for this agent and dataset.
  const matching = grants.filter((g) => g.agentId === req.agentId && g.dataset === req.dataset);

  // 4. Revoked grants.
  const live = matching.filter((g) => !(g.revokedAt !== undefined && g.revokedAt <= now));
  if (matching.length > 0 && live.length === 0) {
    const g = matching[matching.length - 1]!;
    return refuse("deny", req, `${req.agentId}/${req.dataset}: ${g.id} 권한이 철회됨`, g.id);
  }

  // 5. Expired grants.
  const usable = live.filter((g) => g.expiresAt > now);
  if (live.length > 0 && usable.length === 0) {
    const g = live[live.length - 1]!;
    return refuse("deny", req, `${req.agentId}/${req.dataset}: ${g.id} 권한이 만료됨`, g.id);
  }

  // 6. No grant at all.
  if (usable.length === 0) {
    if (SENSITIVE_DATASETS.includes(req.dataset)) {
      return refuse("pending", req, `${req.agentId}: 민감 데이터셋(${req.dataset})은 소유자 승인이 필요함`);
    }
    return refuse("deny", req, `권한 없음: ${req.agentId}의 ${req.dataset} 열람 권한이 없음`);
  }

  // 7. Purpose.
  const grant = usable.find((g) => g.purposes.includes(req.purpose));
  if (!grant) {
    const g = usable[0]!;
    return refuse(
      "deny",
      req,
      `용도 불일치: ${req.purpose} 용도는 ${req.dataset}에 허용되지 않음(허용 용도: ${list(g.purposes) || "없음"})`,
      g.id,
    );
  }

  // 8. Range and row limits.
  if (req.rangeDays !== undefined && grant.maxRangeDays !== undefined && req.rangeDays > grant.maxRangeDays) {
    return refuse(
      "deny",
      req,
      `요청 기간 ${req.rangeDays}일이 허용 ${grant.maxRangeDays}일을 초과함`,
      grant.id,
    );
  }
  if (req.maxRows !== undefined && grant.maxRows !== undefined && req.maxRows > grant.maxRows) {
    return refuse(
      "deny",
      req,
      `최대 행 수 초과: 요청 ${req.maxRows}행이 허용 ${grant.maxRows}행을 초과함`,
      grant.id,
    );
  }

  // 9. Fields.
  const unknown = fields.filter((f) => !grant.allowFields.includes(f) && !grant.maskFields.includes(f));
  if (unknown.length > 0) {
    return refuse("deny", req, `허용되지 않은 필드: ${list(unknown)}(${grant.id} 권한 범위 밖임)`, grant.id);
  }
  const maskFields = fields.filter((f) => grant.maskFields.includes(f));
  const passFields = fields.filter((f) => grant.allowFields.includes(f) && !grant.maskFields.includes(f));

  // 10. Allow.
  const masked = maskFields.length > 0 ? `(가림: ${list(maskFields)})` : "";
  return {
    decision: "allow",
    requestId: req.id,
    grantId: grant.id,
    passFields,
    maskFields,
    reason: `${grant.id} 권한으로 허용${masked}`,
  };
}

export interface PolicyEngine {
  evaluate(req: DataRequest, grants: Grant[], now: number): PolicyResult;
}

/** Policy engine with its own replay-protection set of seen request ids. */
export function createPolicyEngine(): PolicyEngine {
  const seenRequestIds = new Set<string>();
  return {
    evaluate: (req, grants, now) => evaluate(req, grants, now, { seenRequestIds }),
  };
}

export const MASK = "***";

/**
 * Keep only result.passFields and result.maskFields keys of each row; masked values become "***".
 * Returns no rows unless the decision is allow.
 */
export function applyMask(
  rows: readonly Record<string, unknown>[],
  result: PolicyResult,
): Record<string, unknown>[] {
  if (result.decision !== "allow") return [];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of result.passFields) if (Object.hasOwn(row, f)) out[f] = row[f];
    for (const f of result.maskFields) if (Object.hasOwn(row, f)) out[f] = MASK;
    return out;
  });
}
