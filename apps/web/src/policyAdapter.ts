// Policy swap point. The mock engine is gone: U1's real engine (@consent-guard/policy) is wired here.
// Replay protection: evaluate(req, grants, now, { seenRequestIds }) checks and then adds req.id;
// state.ts owns the seen-id set (see approvePending for the one intentional un-burn).
export { evaluate, createPolicyEngine, applyMask, MASK } from "@consent-guard/policy";
export type { EvaluateOptions, PolicyEngine } from "@consent-guard/policy";
