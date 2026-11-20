// On-chain anchor check for the audit log. Reads the NEAR testnet `read_anchor` view once, then compares
// it with the LIVE demo ledger (count + current head) on every render. The anchored head is the final
// head of the full 5-scene demo (see demoScenario.ts), so the badge turns to "일치" exactly when the
// demo reaches the end.
import { fetchAnchor, type AnchorView, type FetchLike } from "@consent-guard/ledger/core";

/** Result of the single RPC read. `anchor: null` = the contract answered but has no anchor yet. */
export type AnchorRead = { kind: "read"; anchor: AnchorView | null } | { kind: "unavailable"; reason: string };

export type AnchorStatusKind = "before" | "match" | "mismatch" | "unavailable";

export interface AnchorStatusResult {
  kind: AnchorStatusKind;
  /** Headline shown in the badge. */
  label: string;
  /** Short Korean reason for the verdict. */
  reason: string;
  liveCount: number;
  liveHead?: string;
  /** On-chain values, when the RPC answered with an anchor. */
  anchorHead?: string;
  count?: number;
  blockHeight?: number;
  timestampMs?: number;
}

export const LABEL_MATCH = "현재 장부 = 온체인 앵커 일치 ✓";
export const LABEL_MISMATCH = "온체인 앵커 불일치 ✗";
export const LABEL_UNAVAILABLE = "앵커 확인 불가";
export const LABEL_CHECKING = "온체인 앵커 확인 중…";
export const labelBefore = (anchorCount: number, liveCount: number) => `${anchorCount}건 중 ${liveCount}건 · 앵커 전`;

/** Minimal fetch shape: global fetch fits; tests pass mocks. */
export type AnchorFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ReadAnchorOptions {
  fetchImpl: AnchorFetch;
  rpcUrl: string;
  contractId: string;
  timeoutMs: number;
}

const short = (hex: string) => `${hex.slice(0, 8)}…`;

/** One `read_anchor` view call with a hard timeout. Never throws. */
export async function readAnchorStatus({ fetchImpl, rpcUrl, contractId, timeoutMs }: ReadAnchorOptions): Promise<AnchorRead> {
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
    const anchor = await Promise.race([fetchAnchor({ rpcUrl, contractId, fetchImpl: fetchWithSignal }), timedOut]);
    return { kind: "read", anchor };
  } catch (e) {
    return { kind: "unavailable", reason: unavailableReason(e, controller.signal.aborted, timeoutMs) };
  } finally {
    clearTimeout(timer);
  }
}

export interface LiveLedger {
  count: number;
  /** Head hash of the live ledger; undefined when empty. */
  head?: string;
  /** Result of the live chain's own verifyChain; a broken chain can never match. */
  chainOk?: boolean;
}

/** Pure verdict: live demo ledger vs the on-chain anchor. */
export function compareLive(read: AnchorRead, live: LiveLedger): AnchorStatusResult {
  const base = { liveCount: live.count, liveHead: live.head };
  if (read.kind === "unavailable") return { ...base, kind: "unavailable", label: LABEL_UNAVAILABLE, reason: read.reason };
  const { anchor } = read;
  if (anchor === null) {
    return { ...base, kind: "mismatch", label: LABEL_MISMATCH, reason: "온체인에 기록된 앵커가 없습니다" };
  }
  const r = {
    ...base,
    anchorHead: anchor.headHash,
    count: anchor.count,
    blockHeight: anchor.blockHeight,
    timestampMs: anchor.timestampMs,
  };
  if (live.chainOk === false) {
    return { ...r, kind: "mismatch", label: LABEL_MISMATCH, reason: "현재 장부의 해시 체인이 손상되었습니다" };
  }
  if (live.count < anchor.count) {
    return {
      ...r,
      kind: "before",
      label: labelBefore(anchor.count, live.count),
      reason: `데모를 끝까지 진행하면 ${anchor.count}건째에 온체인 앵커와 비교합니다`,
    };
  }
  if (live.count > anchor.count) {
    return {
      ...r,
      kind: "mismatch",
      label: LABEL_MISMATCH,
      reason: `건수 초과 (현재 장부 ${live.count}건 > 온체인 앵커 ${anchor.count}건)`,
    };
  }
  if (live.head !== anchor.headHash) {
    return {
      ...r,
      kind: "mismatch",
      label: LABEL_MISMATCH,
      reason: `헤드 해시 불일치 (현재 장부 ${short(live.head ?? "")} ≠ 온체인 ${short(anchor.headHash)})`,
    };
  }
  return { ...r, kind: "match", label: LABEL_MATCH, reason: `${anchor.count}건 · 헤드 ${short(anchor.headHash)}` };
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
