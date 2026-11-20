// On-chain anchor check for the audit log. Compares the NEAR testnet `read_anchor` head against the
// bundled sample snapshot (the chain that was actually anchored), NOT the live demo ledger, which is
// seeded from fixtures/demo.json and grows as scenes progress.
import type { LedgerEvent } from "@consent-guard/policy";
import { fetchAnchor, verifyAgainstAnchor, type AnchorView, type FetchLike } from "@consent-guard/ledger/core";
import sampleChainJson from "../../../packages/ledger/verify/fixtures/sample-chain.json";

/** The 5-event sample chain anchored on testnet (packages/ledger/verify/fixtures/sample-chain.json). */
export const SAMPLE_SNAPSHOT = sampleChainJson as LedgerEvent[];

export type AnchorStatusKind = "match" | "mismatch" | "unavailable";

export interface AnchorStatusResult {
  kind: AnchorStatusKind;
  /** Short Korean reason for the verdict. */
  reason: string;
  compared: "sample-snapshot";
  snapshotCount: number;
  /** Recomputed head of the snapshot, when the snapshot chain is valid. */
  head?: string;
  /** On-chain values, when the RPC answered with an anchor. */
  anchorHead?: string;
  count?: number;
  blockHeight?: number;
  timestampMs?: number;
}

/** Minimal fetch shape: global fetch fits; tests pass mocks. */
export type AnchorFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface CheckAnchorOptions {
  fetchImpl: AnchorFetch;
  rpcUrl: string;
  contractId: string;
  timeoutMs: number;
  snapshot?: readonly LedgerEvent[];
}

const short = (hex: string) => `${hex.slice(0, 8)}…`;

/** Reads the on-chain anchor and verifies the snapshot against it. Never throws. */
export async function checkAnchorStatus({
  fetchImpl,
  rpcUrl,
  contractId,
  timeoutMs,
  snapshot = SAMPLE_SNAPSHOT,
}: CheckAnchorOptions): Promise<AnchorStatusResult> {
  const base = { compared: "sample-snapshot", snapshotCount: snapshot.length } as const;

  let anchor: AnchorView | null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    // Race as well as abort, so a fetch that ignores the signal still cannot hang the badge.
    const fetchWithSignal: FetchLike = (url, init) => fetchImpl(url, { ...init, signal: controller.signal });
    anchor = await Promise.race([fetchAnchor({ rpcUrl, contractId, fetchImpl: fetchWithSignal }), timedOut]);
  } catch (e) {
    return { ...base, kind: "unavailable", reason: unavailableReason(e, controller.signal.aborted, timeoutMs) };
  } finally {
    clearTimeout(timer);
  }

  if (anchor === null) return { ...base, kind: "mismatch", reason: "온체인에 기록된 앵커가 없습니다" };
  const onChain = {
    anchorHead: anchor.headHash,
    count: anchor.count,
    blockHeight: anchor.blockHeight,
    timestampMs: anchor.timestampMs,
  };

  try {
    const check = await verifyAgainstAnchor(snapshot, { headHash: anchor.headHash, count: anchor.count });
    const head = check.head;
    switch (check.status) {
      case "verified":
        return { ...base, ...onChain, head, kind: "match", reason: `샘플 장부 ${snapshot.length}건 헤드 해시·건수 일치` };
      case "head-mismatch":
        return {
          ...base,
          ...onChain,
          head,
          kind: "mismatch",
          reason: `헤드 해시 불일치 (스냅샷 ${short(head ?? "")} ≠ 온체인 ${short(anchor.headHash)})`,
        };
      case "count-mismatch":
        return {
          ...base,
          ...onChain,
          head,
          kind: "mismatch",
          reason: `건수 불일치 (스냅샷 ${snapshot.length}건 ≠ 온체인 ${anchor.count}건)`,
        };
      case "chain-invalid":
        return { ...base, ...onChain, kind: "mismatch", reason: `스냅샷 해시 체인 손상 (#${check.index})` };
      default:
        return { ...base, ...onChain, head, kind: "mismatch", reason: check.reason };
    }
  } catch (e) {
    return { ...base, ...onChain, kind: "unavailable", reason: `검증 실패: ${message(e)}` };
  }
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function unavailableReason(e: unknown, aborted: boolean, timeoutMs: number): string {
  if (aborted) return `RPC 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)`;
  const text = message(e);
  if (/^RPC HTTP \d+/.test(text)) return text;
  if (/^(RPC error|view error|unexpected RPC response|read_anchor returned)/.test(text)) return `RPC 응답 오류: ${text}`;
  if (e instanceof Error && e.name === "AbortError") return "RPC 요청이 중단되었습니다";
  return `네트워크 오류 (오프라인이거나 RPC에 접근할 수 없음): ${text}`;
}
