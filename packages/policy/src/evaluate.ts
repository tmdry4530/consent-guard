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
      return refuse("deny", req, `Request ${req.id} was already processed (replay rejected).`);
    }
    seen.add(req.id);
  }

  const fields = [...new Set(req.fields)];

  // 2. Forbidden raw fields, regardless of grants.
  const forbidden = fields.filter((f) => FORBIDDEN_RAW_FIELDS.includes(f));
  if (forbidden.length > 0) {
    return refuse("deny", req, `Raw field(s) ${list(forbidden)} may never be shared with agents.`);
  }

  // 3. Grants for this agent and dataset.
  const matching = grants.filter((g) => g.agentId === req.agentId && g.dataset === req.dataset);

  // 4. Revoked grants.
  const live = matching.filter((g) => !(g.revokedAt !== undefined && g.revokedAt <= now));
  if (matching.length > 0 && live.length === 0) {
    const g = matching[matching.length - 1]!;
    return refuse("deny", req, `Grant ${g.id} for ${req.agentId} on ${req.dataset} was revoked by the owner.`, g.id);
  }

  // 5. Expired grants.
  const usable = live.filter((g) => g.expiresAt > now);
  if (live.length > 0 && usable.length === 0) {
    const g = live[live.length - 1]!;
    return refuse("deny", req, `Grant ${g.id} for ${req.agentId} on ${req.dataset} has expired.`, g.id);
  }

  // 6. No grant at all.
  if (usable.length === 0) {
    if (SENSITIVE_DATASETS.includes(req.dataset)) {
      return refuse("pending", req, `Sensitive dataset ${req.dataset} needs owner approval for ${req.agentId}.`);
    }
    return refuse("deny", req, `No grant lets ${req.agentId} read ${req.dataset}.`);
  }

  // 7. Purpose.
  const grant = usable.find((g) => g.purposes.includes(req.purpose));
  if (!grant) {
    const g = usable[0]!;
    return refuse(
      "deny",
      req,
      `Purpose "${req.purpose}" is not allowed for ${req.dataset} (allowed: ${list(g.purposes) || "none"}).`,
      g.id,
    );
  }

  // 8. Range and row limits.
  if (req.rangeDays !== undefined && grant.maxRangeDays !== undefined && req.rangeDays > grant.maxRangeDays) {
    return refuse(
      "deny",
      req,
      `Requested range of ${req.rangeDays} days exceeds the grant limit of ${grant.maxRangeDays} days.`,
      grant.id,
    );
  }
  if (req.maxRows !== undefined && grant.maxRows !== undefined && req.maxRows > grant.maxRows) {
    return refuse(
      "deny",
      req,
      `Requested ${req.maxRows} rows exceeds the grant limit of ${grant.maxRows} rows.`,
      grant.id,
    );
  }

  // 9. Fields.
  const unknown = fields.filter((f) => !grant.allowFields.includes(f) && !grant.maskFields.includes(f));
  if (unknown.length > 0) {
    return refuse("deny", req, `Field(s) ${list(unknown)} are not covered by grant ${grant.id}.`, grant.id);
  }
  const maskFields = fields.filter((f) => grant.maskFields.includes(f));
  const passFields = fields.filter((f) => grant.allowFields.includes(f) && !grant.maskFields.includes(f));

  // 10. Allow.
  const masked = maskFields.length > 0 ? `; masked: ${list(maskFields)}` : "";
  return {
    decision: "allow",
    requestId: req.id,
    grantId: grant.id,
    passFields,
    maskFields,
    reason: `Allowed by grant ${grant.id} for purpose "${req.purpose}" (fields: ${list(passFields) || "none"}${masked}).`,
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
