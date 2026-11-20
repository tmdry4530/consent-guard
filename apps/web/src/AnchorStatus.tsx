import { useEffect, useState } from "react";
import { anchorConfig } from "./anchorConfig";
import { checkAnchorStatus, SAMPLE_SNAPSHOT, type AnchorStatusResult } from "./anchorStatus";

const LABEL: Record<AnchorStatusResult["kind"], string> = {
  match: "온체인 앵커 일치 ✓",
  mismatch: "온체인 앵커 불일치 ✗",
  unavailable: "앵커 확인 불가",
};
const TONE: Record<AnchorStatusResult["kind"], string> = { match: "ok", mismatch: "bad", unavailable: "warn" };

/** NEAR testnet anchor status for the sample snapshot; non-blocking, never throws into render. */
export function AnchorStatus({ liveCount }: { liveCount: number }) {
  const [status, setStatus] = useState<AnchorStatusResult | null>(null);

  useEffect(() => {
    let live = true;
    const config = anchorConfig();
    checkAnchorStatus({
      fetchImpl: (url, init) => fetch(url, init),
      rpcUrl: config.rpcUrl,
      contractId: config.contractId,
      timeoutMs: config.timeoutMs,
    }).then(
      (r) => live && setStatus(r),
      // checkAnchorStatus does not throw; this only guards against a bug turning into an unhandled rejection.
      (e: unknown) =>
        live &&
        setStatus({
          kind: "unavailable",
          reason: String(e),
          compared: "sample-snapshot",
          snapshotCount: SAMPLE_SNAPSHOT.length,
        }),
    );
    return () => {
      live = false;
    };
  }, []);

  const config = anchorConfig();
  const n = SAMPLE_SNAPSHOT.length;
  return (
    <div className="anchor" data-testid="anchor-status" data-kind={status?.kind ?? "checking"}>
      <div className="anchor-line">
        <span className={`anchor-label ${status ? TONE[status.kind] : "pending"}`}>
          {status ? LABEL[status.kind] : "온체인 앵커 확인 중…"}
        </span>
        {status && <span className="anchor-reason">{status.reason}</span>}
        {status?.blockHeight !== undefined && (
          <span
            className="mono anchor-block"
            title={status.timestampMs ? new Date(status.timestampMs).toISOString() : undefined}
          >
            블록 #{status.blockHeight.toLocaleString("en-US")}
          </span>
        )}
        <span className="anchor-links">
          <a href={config.txUrl} target="_blank" rel="noopener noreferrer">
            앵커 tx
          </a>
          <a href={config.accountUrl} target="_blank" rel="noopener noreferrer">
            계약
          </a>
        </span>
      </div>
      <div className="anchor-note">
        NEAR 테스트넷에 기록된 샘플 장부 {n}건 스냅샷과 비교합니다. 아래 데모 감사 로그는 장면 진행용이라 이 스냅샷과
        다를 수 있습니다. 지금 보는 데모 장부는 {liveCount}건이며 아직 이 앵커에 포함되지 않습니다.
      </div>
    </div>
  );
}
