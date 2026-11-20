import { useEffect, useState } from "react";
import { anchorConfig, mockAnchorView } from "./anchorConfig";
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

/**
 * Live demo ledger vs the NEAR testnet anchor; reads the RPC once, non-blocking, never throws into render.
 * Mock mode (?mock=1 / VITE_ANCHOR_MOCK=1) never calls the RPC and uses the canned final demo anchor.
 */
export function AnchorStatus({ liveCount, liveHead, chainOk }: Props) {
  const [read, setRead] = useState<AnchorRead | null>(() =>
    anchorConfig().mock ? { kind: "read", anchor: mockAnchorView() } : null,
  );

  useEffect(() => {
    const config = anchorConfig();
    if (config.mock) return;
    let live = true;
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
      {config.mock && (
        <div className="anchor-mock" data-testid="anchor-mock-banner">
          목 RPC · 오프라인 대체
        </div>
      )}
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
      {config.mock ? (
        <div className="anchor-note">
          오프라인 대체 모드: NEAR 테스트넷 RPC를 호출하지 않고, 실제 앵커와 같은 최종 헤드·건수·블록을 미리 넣어 둔 목
          응답과 비교합니다. 라이브 테스트넷 확인이 아닙니다. 지금 장부는 {liveCount}건입니다.
        </div>
      ) : (
        <div className="anchor-note">
          NEAR 테스트넷에는 데모 5장면을 끝까지 진행했을 때의 최종 장부 헤드가 앵커되어 있습니다. 시계가 고정이라 끝까지
          진행하면 항상 같은 헤드가 나오고, 그때 현재 장부와 온체인 앵커를 비교합니다. 지금 장부는 {liveCount}건입니다.
        </div>
      )}
    </div>
  );
}
