import { useCallback, useEffect, useRef, useState } from "react";
import type { DataRequest, Decision, Grant, LedgerEvent } from "@consent-guard/policy";
import { append, list, type LedgerInput } from "@consent-guard/ledger/adapter";
// Not the adapter's verifyChain: that one returns a bare boolean; core's returns { ok, index, reason }.
import { verifyChain, type VerifyResult } from "@consent-guard/ledger/core";
import type { ConsentProxy } from "@consent-guard/proxy";
import { awaitingAi, fetchAi, withAi } from "./ai";
import { TEN_MIN, sampleData } from "./fixtures";
import { applyMask, MASK } from "./policyAdapter";
import {
  advanceDemoClock,
  approvePending,
  canRevokeGrant,
  rejectPending,
  revokeGrant,
  type AppState,
  type RequestEntry,
  type Transition,
} from "./state";

const DECISION_LABEL: Record<Decision, string> = { allow: "허용", deny: "거부", pending: "대기" };
const KIND_LABEL: Record<LedgerEvent["kind"], string> = {
  grant: "권한 부여",
  access: "접근",
  deny: "거부",
  pending: "대기",
  revoke: "철회",
};
/** Display safety net: raw identifiers are never rendered, whatever the policy says. */
const NEVER_DISPLAY = new Set([
  "account_number",
  "card_number",
  "resident_id",
  "ssn",
  "cvv",
  "password",
  "계좌번호",
  "rrn",
  "resident_registration_number",
  "주민등록번호",
]);

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
const clockFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Demo clock label, e.g. "2026-11-20 20:00 KST". */
function clockLabel(ms: number): string {
  const p = Object.fromEntries(clockFmt.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} KST`;
}

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
  /** Consent proxy used to get the AI answer when a request becomes allowed (after 허용). */
  proxy: ConsentProxy;
  afterRevoke: Record<string, DataRequest>;
  /** grantId -> follow-up request enqueued once the demo clock passes that grant's TTL. */
  afterExpire: Record<string, DataRequest>;
  /** Demo clock origin (fixture NOW). The clock is frozen; only the "+10분" button advances it. */
  startAt: number;
}

export function App({ initial, initialLedger, proxy, afterRevoke, afterExpire, startAt }: AppProps) {
  const [state, setState] = useState(initial);
  const [ledger, setLedger] = useState(initialLedger);
  const [chain, setChain] = useState<VerifyResult | null>(null);
  const [now, setNow] = useState(startAt);

  const nowRef = useRef(startAt);
  const stateRef = useRef(state);
  const ledgerQueue = useRef(Promise.resolve(initialLedger));
  const aiInFlight = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    verifyChain(ledger).then((r) => live && setChain(r));
    return () => {
      live = false;
    };
  }, [ledger]);

  /** Run a transition at the frozen demo time. */
  const apply = useCallback((make: (s: AppState, at: number) => Transition) => {
    const t = make(stateRef.current, nowRef.current);
    if (t.state === stateRef.current) return;
    stateRef.current = t.state;
    setState(t.state);
    const events: LedgerInput[] = t.events;
    // Serialize async hashing so the chain order matches action order.
    ledgerQueue.current = ledgerQueue.current.then(async (chain) => {
      const next = await append(chain, events);
      setLedger(next);
      return next;
    });
    // Newly allowed requests (approve): fetch the AI answer once, at decision time, and keep it.
    const ids = awaitingAi(t.state).filter((id) => !aiInFlight.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) aiInFlight.current.add(id);
    fetchAi(proxy, t.state, ids, nowRef.current).then((outcomes) => {
      stateRef.current = withAi(stateRef.current, outcomes);
      setState(stateRef.current);
    });
  }, [proxy]);

  const advanceClock = useCallback(() => {
    nowRef.current += TEN_MIN;
    setNow(nowRef.current);
    apply((s, at) => advanceDemoClock(s, at, afterExpire));
  }, [apply, afterExpire]);

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
          <span className="muted">데모 시계</span>{" "}
          <span className="mono clock-time" data-testid="demo-clock">
            {clockLabel(now)}
          </span>
          <button className="btn advance" data-testid="advance-clock" onClick={advanceClock}>
            +10분
          </button>
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
                  {!expired && (
                    <div className="actions">
                      <button
                        className="btn revoke"
                        data-testid={`revoke-${g.id}`}
                        disabled={!canRevokeGrant(g, now)}
                        onClick={() => apply((s, at) => revokeGrant(s, g.id, at, followUpFor(g)))}
                      >
                        철회
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card span-6" data-testid="audit-log">
          <h2>
            감사 로그
            <span className={`chain ${chain?.ok === false ? "bad" : "ok"}`} data-testid="chain-status">
              {chain === null
                ? "검증 중…"
                : chain.ok
                  ? "해시 체인 검증 ✓"
                  : `해시 체인 손상 ✗ #${chain.index} ${chain.reason}`}
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
            <ul className="list ai-list">
              {allowed.map(({ request: r, ai, aiError }) => (
                <li key={r.id} className="item ai-card" data-testid={`ai-card-${r.id}`}>
                  <div className="row">
                    <strong>{r.agentId}</strong>
                    {ai && <span className={`badge ${ai.badge}`}>{ai.badge}</span>}
                  </div>
                  {ai ? (
                    <p className="ai-text">{ai.text}</p>
                  ) : aiError !== undefined ? (
                    <p className="empty small" title={aiError}>
                      AI 응답 없음 (라이브 모델 호출 안 함)
                    </p>
                  ) : (
                    <p className="empty small">AI 응답 대기 중…</p>
                  )}
                </li>
              ))}
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

function cell(row: Record<string, unknown>, field: string): string {
  if (NEVER_DISPLAY.has(field)) return MASK;
  const v = row[field];
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "number" ? v.toLocaleString("ko-KR") : String(v);
}

function Released({ entry: { request: r, result } }: { entry: RequestEntry }) {
  const sample = sampleData[r.dataset];
  // Only what the policy released: passFields as-is, maskFields replaced by "***".
  const rows = sample ? applyMask(sample, result) : undefined;
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
                {columns.map((c) =>
                  Object.hasOwn(row, c) ? (
                    <td key={c} className={row[c] === MASK ? "masked" : ""}>
                      {cell(row, c)}
                    </td>
                  ) : null,
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
