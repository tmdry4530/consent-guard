// MOCK policy engine — used until U1's packages/policy `evaluate` lands.
// SWAP POINT: replace the body of this module with
//   export { evaluate } from "../../../packages/policy/src/index";
// The signature below is the agreed contract; do not add parameters.
//
// Replay protection: evaluate() is stateless (no memory of request ids). Replay is
// enforced at the app level in state.ts (`submitRequest` ignores an id that was
// already decided; only an explicit grant change — approve — re-evaluates an id).
import type { DataRequest, Grant, PolicyResult } from "../../../packages/policy/src/types";

/** Raw identifiers that are never released, regardless of grants. */
const FORBIDDEN_FIELDS = new Set([
  "account_number",
  "rrn",
  "resident_id",
  "resident_registration_number",
  "계좌번호",
  "주민등록번호",
]);

const SENSITIVE_DATASETS = new Set(["medical_record", "location"]);

function sameTarget(req: DataRequest, g: Grant): boolean {
  return g.agentId === req.agentId && g.dataset === req.dataset;
}

/** Why a live (not revoked, not expired) grant does not cover the request, or null if it does. */
function mismatch(req: DataRequest, g: Grant): string | null {
  if (!g.purposes.includes(req.purpose)) return `목적 불일치(${req.purpose})`;
  if (req.rangeDays !== undefined && g.maxRangeDays !== undefined && req.rangeDays > g.maxRangeDays)
    return `기간 초과(${req.rangeDays}일 > ${g.maxRangeDays}일)`;
  if (req.maxRows !== undefined && g.maxRows !== undefined && req.maxRows > g.maxRows)
    return `행 수 초과(${req.maxRows} > ${g.maxRows})`;
  const covered = new Set([...g.allowFields, ...g.maskFields]);
  const extra = req.fields.filter((f) => !covered.has(f));
  if (extra.length > 0) return `허용 범위 밖 필드(${extra.join(", ")})`;
  return null;
}

export function evaluate(req: DataRequest, grants: Grant[], now: number): PolicyResult {
  const base = { requestId: req.id, passFields: [] as string[], maskFields: [] as string[] };

  const forbidden = req.fields.filter((f) => FORBIDDEN_FIELDS.has(f));
  if (forbidden.length > 0) {
    return { ...base, decision: "deny", reason: `원본 식별자 요청 금지(${forbidden.join(", ")}) → 거부` };
  }

  const candidates = grants.filter((g) => sameTarget(req, g));
  const live = candidates.filter((g) => g.revokedAt === undefined && g.expiresAt > now);
  let firstMismatch: string | null = null;
  for (const g of live) {
    const why = mismatch(req, g);
    if (why === null) {
      const passFields = req.fields.filter((f) => g.allowFields.includes(f));
      const maskFields = req.fields.filter((f) => g.maskFields.includes(f));
      const masked = maskFields.length > 0 ? ` · ${maskFields.join(", ")} 마스킹` : "";
      return {
        ...base,
        decision: "allow",
        grantId: g.id,
        passFields,
        maskFields,
        reason: `권한 일치(${g.id}) · 목적 ${req.purpose}${masked}`,
      };
    }
    firstMismatch ??= why;
  }

  if (candidates.some((g) => g.revokedAt !== undefined)) {
    return { ...base, decision: "deny", reason: "권한 철회됨 → 즉시 거부" };
  }
  const expired = candidates.some((g) => g.expiresAt <= now);
  if (SENSITIVE_DATASETS.has(req.dataset)) {
    const why = expired ? "권한 만료(TTL)" : firstMismatch ?? "유효한 권한 없음";
    return { ...base, decision: "pending", reason: `민감 데이터 · ${why} → 사용자 승인 대기` };
  }
  const why = firstMismatch ?? (expired ? "권한 만료(TTL)" : "일치하는 권한 없음");
  return { ...base, decision: "deny", reason: `${why} → 거부` };
}
