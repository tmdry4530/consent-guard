import { useCallback, useEffect, useRef, useState } from "react";
import type { DataRequest, Decision, Grant, LedgerEvent } from "../../../packages/policy/src/types";
import { aiResponses, sampleData, type SampleRow } from "./fixtures";
import { append, list, verifyChain, type LedgerInput } from "./ledgerAdapter";
import { approvePending, rejectPending, revokeGrant, type AppState, type RequestEntry, type Transition } from "./state";

const DECISION_LABEL: Record<Decision, string> = { allow: "허용", deny: "거부", pending: "대기" };
const KIND_LABEL: Record<LedgerEvent["kind"], string> = {
  grant: "권한 부여",
  access: "접근",
  deny: "거부",
  pending: "대기",
  revoke: "철회",
};
/** Display safety net: raw identifiers are never rendered, whatever the policy says. */
const NEVER_DISPLAY = new Set(["account_number", "계좌번호", "rrn", "resident_id", "resident_registration_number", "주민등록번호"]);

const timeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function remaining(ms: number): string {
  if (ms <= 0) return "만료됨";
  const min = Math.floor(ms / 60_000);
  if (min >= 1440) return `${Math.floor(min / 1440)}일 남음`;
  if (min >= 60) return `${Math.floor(min / 60)}시간 남음`;
  return min >= 1 ? `${min}분 남음` : `${Math.ceil(ms / 1000)}초 남음`;
}

interface AppProps {
  initial: AppState;
  initialLedger: LedgerEvent[];
  afterRevoke: Record<string, DataRequest>;
  /** Demo clock origin (fixture NOW); the clock then advances in real time. */
  startAt: number;
}

export function App({ initial, initialLedger, afterRevoke, startAt }: AppProps) {
  const [state, setState] = useState(initial);
  const [ledger, setLedger] = useState(initialLedger);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  const [now, setNow] = useState(startAt);

  const realStart = useRef(Date.now());
  const clock = useCallback(() => startAt + (Date.now() - realStart.current), [startAt]);
  const stateRef = useRef(state);
  const ledgerQueue = useRef(Promise.resolve(initialLedger));

  useEffect(() => {
    const t = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(t);
  }, [clock]);

  useEffect(() => {
    let live = true;
    verifyChain(ledger).then((ok) => live && setChainOk(ok));
    return () => {
      live = false;
    };
  }, [ledger]);

  const apply = useCallback((make: (s: AppState, at: number) => Transition) => {
    const t = make(stateRef.current, clock());
    if (t.state === stateRef.current) return;
    stateRef.current = t.state;
    setState(t.state);
    setNow(clock());
    const events: LedgerInput[] = t.events;
    // Serialize async hashing so the chain order matches action order.
    ledgerQueue.current = ledgerQueue.current.then(async (chain) => {
      const next = await append(chain, events);
      setLedger(next);
      return next;
    });
  }, [clock]);

  const followUpFor = (g: Grant): DataRequest | undefined =>
    afterRevoke[g.id] ??
    (g.dataset === "card_tx" && g.purposes.includes("budgeting") ? afterRevoke["grant-card-budget"] : undefined);

  const pending = state.requests.filter((e) => e.result.decision === "pending");
  const allowed = state.requests.filter((e) => e.result.decision === "allow");

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Consent Guard</h1>
          <p className="subtitle">내 데이터, 내가 정한 만큼만</p>
        </div>
        <div className="clock">
          <span className="muted">데모 시계</span> <span className="mono">{timeFmt.format(now)} KST</span>
        </div>
      </header>

      <main className="grid">
        <section className="card span-5" data-testid="request-feed">
          <h2>
            요청 피드 <span className="count">{state.requests.length}</span>
          </h2>
          <ul className="list">
            {[...state.requests].reverse().map((e) => (
              <FeedItem key={e.request.id} entry={e} />
            ))}
          </ul>
        </section>

        <section className="card span-3" data-testid="approval-queue">
          <h2>
            승인 대기 <span className="count">{pending.length}</span>
          </h2>
          {pending.length === 0 ? (
            <p className="empty">대기 중인 요청 없음</p>
          ) : (
            <ul className="list">
              {pending.map(({ request: r }) => (
                <li key={r.id} className="item">
                  <div className="row">
                    <strong>{r.agentId}</strong>
                    <span className="mono muted">{r.dataset}</span>
                  </div>
                  <Fields fields={r.fields} />
                  <div className="muted small">목적: {r.purpose}</div>
                  <div className="actions">
                    <button
                      className="btn allow"
                      data-testid={`approve-${r.id}`}
                      onClick={() => apply((s, at) => approvePending(s, r.id, at))}
                    >
                      허용
                    </button>
                    <button
                      className="btn deny"
                      data-testid={`reject-${r.id}`}
                      onClick={() => apply((s, at) => rejectPending(s, r.id, at))}
                    >
                      거절
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card span-4" data-testid="grant-list">
          <h2>
            권한 <span className="count">{state.grants.length}</span>
          </h2>
          <ul className="list">
            {state.grants.map((g) => {
              const revoked = g.revokedAt !== undefined;
              const expired = !revoked && g.expiresAt <= now;
              return (
                <li key={g.id} className={`item ${revoked || expired ? "inactive" : ""}`}>
                  <div className="row">
                    <strong>{g.agentId}</strong>
                    <span className="mono muted">{g.dataset}</span>
                    {revoked ? (
                      <span className="badge deny">철회됨</span>
                    ) : expired ? (
                      <span className="badge neutral">만료</span>
                    ) : (
                      <span className="badge allow">유효</span>
                    )}
                  </div>
                  <Fields fields={g.allowFields} masked={g.maskFields} />
                  <div className="row small muted">
                    <span>목적: {g.purposes.join(", ")}</span>
                    <span>
                      만료 {dateTimeFmt.format(g.expiresAt)} · {revoked ? `철회 ${timeFmt.format(g.revokedAt!)}` : remaining(g.expiresAt - now)}
                    </span>
                  </div>
                  <div className="actions">
                    <button
                      className="btn revoke"
                      data-testid={`revoke-${g.id}`}
                      disabled={revoked}
                      onClick={() => apply((s, at) => revokeGrant(s, g.id, at, followUpFor(g)))}
                    >
                      철회
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card span-6" data-testid="audit-log">
          <h2>
            감사 로그 <span className="tag">mock</span>
            <span className={`chain ${chainOk === false ? "bad" : "ok"}`}>
              {chainOk === null ? "검증 중…" : chainOk ? "해시 체인 검증 ✓" : "해시 체인 손상 ✗"}
            </span>
          </h2>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>종류</th>
                  <th>시각</th>
                  <th>에이전트</th>
                  <th>데이터</th>
                  <th>필드</th>
                  <th>해시</th>
                </tr>
              </thead>
              <tbody>
                {list(ledger).map((e) => (
                  <tr key={e.seq}>
                    <td className="mono">{e.seq}</td>
                    <td>
                      <span className={`kind ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                    </td>
                    <td className="mono">{timeFmt.format(e.at)}</td>
                    <td>{e.agentId}</td>
                    <td className="mono">{e.dataset}</td>
                    <td className="fields-cell">{e.fields.join(", ")}</td>
                    <td className="mono hash" title={`${e.hash}\nprev ${e.prevHash}`}>
                      {e.hash.slice(0, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card span-3" data-testid="released-data">
          <h2>전달 데이터</h2>
          {allowed.length === 0 ? (
            <p className="empty">전달된 데이터 없음</p>
          ) : (
            <div className="scroll">
              {allowed.map((e) => (
                <Released key={e.request.id} entry={e} />
              ))}
            </div>
          )}
        </section>

        <section className="card span-3" data-testid="ai-responses">
          <h2>AI 답변</h2>
          {allowed.length === 0 ? (
            <p className="empty">허용된 요청 없음</p>
          ) : (
            <ul className="list">
              {allowed.map(({ request: r }) => {
                const ai = aiResponses.get(r.id);
                return (
                  <li key={r.id} className="item">
                    <div className="row">
                      <strong>{r.agentId}</strong>
                      {ai && <span className="badge recorded">recorded</span>}
                    </div>
                    {ai ? <p className="ai-text">{ai.text}</p> : <p className="empty small">녹화된 응답 없음 (라이브 모델 호출 안 함)</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function FeedItem({ entry: { request: r, result, resolvedBy } }: { entry: RequestEntry }) {
  return (
    <li className="item" data-testid={`feed-${r.id}`}>
      <div className="row">
        <span className={`badge ${result.decision}`}>{DECISION_LABEL[result.decision]}</span>
        <strong>{r.agentId}</strong>
        <span className="mono muted">{r.dataset}</span>
        {resolvedBy && <span className="tag">{resolvedBy === "approve" ? "사용자 승인" : "사용자 거절"}</span>}
        <span className="mono muted small push">{timeFmt.format(r.at)}</span>
      </div>
      <div className="reason">{result.reason}</div>
      <div className="small muted">
        {r.fields.join(", ")} · 목적 {r.purpose}
        {r.rangeDays !== undefined && ` · ${r.rangeDays}일`}
      </div>
    </li>
  );
}

function Fields({ fields, masked = [] }: { fields: string[]; masked?: string[] }) {
  return (
    <div className="chips">
      {fields.map((f) => (
        <span key={f} className="chip">
          {f}
        </span>
      ))}
      {masked.map((f) => (
        <span key={f} className="chip masked" title="마스킹 전달">
          {f} ***
        </span>
      ))}
    </div>
  );
}

function cell(row: SampleRow, field: string, masked: boolean): string {
  if (masked || NEVER_DISPLAY.has(field)) return "***";
  const v = row[field];
  if (v === undefined) return "—";
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "number" ? v.toLocaleString("ko-KR") : v;
}

function Released({ entry: { request: r, result } }: { entry: RequestEntry }) {
  const rows = sampleData[r.dataset];
  const columns = r.fields.filter((f) => result.passFields.includes(f) || result.maskFields.includes(f));
  return (
    <div className="released">
      <div className="row small">
        <strong>{r.agentId}</strong>
        <span className="mono muted">{r.dataset}</span>
      </div>
      {!rows ? (
        <p className="empty small">샘플 데이터 없음</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => {
                  const masked = result.maskFields.includes(c);
                  return (
                    <td key={c} className={masked ? "masked" : ""}>
                      {cell(row, c, masked)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
