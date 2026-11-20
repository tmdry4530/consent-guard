import { useEffect, useState } from "react";
import { anchorConfig } from "./anchorConfig";
import { LABEL_CHECKING, compareLive, readAnchorStatus, type AnchorRead, type AnchorStatusResult } from "./anchorStatus";

const TONE: Record<AnchorStatusResult["kind"], string> = {
  before: "pending",
  match: "ok",
  mismatch: "bad",
  unavailable: "warn",
};

interface Props {
  liveCount: number;
  liveHead?: string;
  chainOk?: boolean;
}

/** Live demo ledger vs the NEAR testnet anchor; reads the RPC once, non-blocking, never throws into render. */
export function AnchorStatus({ liveCount, liveHead, chainOk }: Props) {
  const [read, setRead] = useState<AnchorRead | null>(null);

  useEffect(() => {
    let live = true;
    const config = anchorConfig();
    readAnchorStatus({
      fetchImpl: (url, init) => fetch(url, init),
      rpcUrl: config.rpcUrl,
      contractId: config.contractId,
      timeoutMs: config.timeoutMs,
    }).then(
      (r) => live && setRead(r),
      // readAnchorStatus does not throw; this only guards against a bug turning into an unhandled rejection.
      (e: unknown) => live && setRead({ kind: "unavailable", reason: String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);

  const config = anchorConfig();
  const status = read && compareLive(read, { count: liveCount, head: liveHead, chainOk });
  return (
    <div className="anchor" data-testid="anchor-status" data-kind={status?.kind ?? "checking"}>
      <div className="anchor-line">
        <span className={`anchor-label ${status ? TONE[status.kind] : "pending"}`} data-testid="anchor-label">
          {status ? status.label : LABEL_CHECKING}
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
        NEAR 테스트넷에는 데모 5장면을 끝까지 진행했을 때의 최종 장부 헤드가 앵커되어 있습니다. 시계가 고정이라 끝까지
        진행하면 항상 같은 헤드가 나오고, 그때 현재 장부와 온체인 앵커를 비교합니다. 지금 장부는 {liveCount}건입니다.
      </div>
    </div>
  );
}
