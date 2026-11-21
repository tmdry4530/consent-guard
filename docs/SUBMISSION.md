# Consent Guard — 제출 초안 / Submission draft

Nesa.ai x 블록체인밸리 해커톤, 트랙 2 ("Building AI through Privacy").
저장소 / Repository: https://github.com/tmdry4530/consent-guard
이 문서는 제출용 초안이며, 모든 수치와 명령은 저장소 내용([README](../README.md), [발표 런북](RUNBOOK.md), 각 패키지 README, 소스, `fixtures/`)에서 가져왔습니다.
This is a submission draft; every number and command comes from the repo ([README](../README.md), [presentation runbook](RUNBOOK.md), package READMEs, sources, `fixtures/`).

---

## 한국어

### 1. 한 줄 소개

AI 에이전트가 개인 데이터에 접근할 때 동의된 필드만, 동의된 용도·기간에만 넘기고, 모든 결정을 해시 체인 감사 로그에 남겨 그 헤드를 NEAR 테스트넷에 앵커하는 동의 게이트웨이.

### 2. 문제

AI 에이전트(가계부, 세무, 건강, 식단 등)는 사용자 데이터를 통째로 받는 경우가 많습니다. 사용자는 어떤 필드가 어떤 용도로 언제까지 넘어갔는지 알기 어렵고, 동의를 철회해도 바로 반영되는지 확인할 방법이 없으며, 접근 기록이 사후에 조작되지 않았다는 것도 증명하기 어렵습니다. 계좌번호·주민등록번호처럼 어떤 경우에도 원문으로 넘어가면 안 되는 값도 있습니다.

### 3. 해결

에이전트 요청(`agentId`, `dataset`, `fields`, `purpose`)은 모두 정책 엔진을 거칩니다. 결과는 허용 / 거부 / 승인 대기 중 하나이고, 허용된 경우에만 동의된 필드가 마스킹을 거쳐 AI 어댑터로 전달됩니다. 모든 결정(grant / access / deny / pending / revoke)은 sha256 해시 체인 장부에 기록되고, 최종 장부 헤드는 NEAR 테스트넷 계약에 앵커됩니다.

데모는 `fixtures/demo.json`의 고정 시계(2026-11-20 20:00 KST)에서 5장면으로 진행됩니다. 사유 문자열은 정책 엔진의 실제 출력입니다.

1. **카드 내역 허용 + 가맹점명 가림** — `budget-agent`가 `card_tx`의 `category, amount, merchant` 요청 → 허용, `merchant`는 `***`로 전달. `grant-card-budget 권한으로 허용(가림: merchant)`
2. **계좌번호 원문 요청 차단** — `tax-agent`의 `account_number` 요청 → 동의와 무관하게 거부, AI 호출 없음. `원문 금지 필드 요청: account_number`
3. **진료기록 승인 대기 → 사용자 승인** — `health-agent`의 `medical_record` 요청 → 승인 대기. 웹에서 승인하면 요청 그대로의 1시간 권한이 생기고 재평가되어 허용.
4. **알레르기 식단 용도 10분 허용 → 만료 거부** — `diet-agent`가 `diet_recommendation` 용도로 `allergy`만 요청 → 허용. "+10분" 후 후속 요청은 `diet-agent/medical_record: grant-allergy-diet 권한이 만료됨`으로 거부.
5. **카드 권한 철회 → 재요청 즉시 거부** — `grant-card-budget` 철회 직후 재요청 거부(`budget-agent/card_tx: grant-card-budget 권한이 철회됨`), AI 호출 없음. 감사 로그에 해시 체인 검증 결과와 온체인 앵커 상태 패널이 표시됩니다.

### 4. 프라이버시 보장

| 보장 | 코드에서의 적용 | 패키지 |
| --- | --- | --- |
| 원문 금지 필드 | `FORBIDDEN_RAW_FIELDS`(`account_number`, `card_number`, `resident_id`, `ssn`, `cvv`, `password`)가 하나라도 요청되면 `evaluate`의 2번째 규칙에서 동의 확인 전에 거부. 웹 UI도 별도의 `NEVER_DISPLAY` 목록으로 이 값들을 화면에 그리지 않음. | `@consent-guard/policy` (`src/evaluate.ts`), `apps/web` (`src/App.tsx`) |
| 마스킹 | 동의의 `maskFields`에 있는 필드는 `applyMask`가 값을 `***`로 바꿈. 동의 범위(`allowFields` + `maskFields`) 밖 필드가 요청에 있으면 요청 전체를 거부. 허용이 아니면 `applyMask`는 빈 배열을 반환. 프록시는 허용된 경우에만 마스킹된 행(최대 `maxRows`)을 어댑터로 넘김. | `@consent-guard/policy` (`applyMask`), `@consent-guard/proxy` (`src/proxy.ts`) |
| 철회 즉시 차단 | `revokedAt <= now`인 동의만 남으면 `evaluate`가 거부. 프록시는 거부 시 어댑터를 호출하지 않으며, 통합 테스트가 어댑터 호출 횟수로 이를 확인. | `@consent-guard/policy`, `@consent-guard/proxy`, `@consent-guard/integration` |
| 해시 체인 | 각 이벤트를 canonical JSON(키 정렬, 공백 없음)의 sha256으로 해시하고 `prevHash`로 연결(첫 이벤트는 `"0".repeat(64)`). `verifyChain`이 변조 시 첫 오류 위치(index)와 사유를 반환. 장부에는 필드 이름만 기록되고 값은 기록되지 않음. | `@consent-guard/ledger` (`src/core.js`) |
| 온체인 앵커 | Rust NEAR 계약(`contracts/anchor`)의 `anchor(head_hash, count)`(소유자 전용)로 헤드 해시와 개수를 저장, `read_anchor()`로 조회. 웹 앵커 패널은 `read_anchor`를 한 번 읽어 현재 장부의 건수·헤드와 비교. 꼬리 절단처럼 체인만으로는 드러나지 않는 변조를 앵커 비교로 검출. | `@consent-guard/ledger`, `apps/web` (`src/anchorStatus.ts`) |

그 외 `evaluate`가 적용하는 규칙: 이미 처리된 요청 id 재사용 거부(재요청 차단), 동의에 없는 용도 거부, `maxRangeDays`·`maxRows` 초과 거부, 모든 동의의 `expiresAt`(TTL) 경과 시 거부, 민감 데이터셋(`medical_record`, `location`)에 동의가 없으면 승인 대기.

**최종 앵커 정보** (`packages/ledger/README.md`, `apps/web/src/anchorConfig.ts`):

- 계약 계정: `consent-guard-anchor.tee-receipts-chamdom.testnet` (NEAR 테스트넷)
- 앵커 tx: `51udtFvQ4Po2E4Pj6H2gTTKAvK2VRKCGgBeAN7A25P2y`
- 블록: 278,539,285 (2026-11-20 22:41:52 KST)
- 내용: 웹 데모 5장면을 끝까지 진행한 최종 장부, 11건, 헤드 `259dbd26b973e4a7e8252488ce2a4d97d532f8355825b4edc3722c97b20fa95b`
- 첫 앵커 tx `Gx1HfEQYRQh9RwLr1DJstmV6m6dJEaCFQ3RnXM39bHhE`(샘플 fixture 5건, 블록 278,537,646)는 이력입니다.

### 5. 기술 스택

- Node 23.6 이상(루트 `.nvmrc` = `23.6`, `package.json` `engines` `>=23.6`), TypeScript를 type stripping으로 직접 실행(빌드 단계 없음), npm workspaces. Node 24.22에서 확인.
- 패키지: `@consent-guard/policy`(정책 엔진), `@consent-guard/proxy`(동의 프록시, fixture LLM 어댑터), `@consent-guard/ledger`(해시 체인, NEAR 앵커 계약·스크립트, 정적 검증 페이지), `@consent-guard/integration`(프록시 + 장부 파이프라인, `demo:cli`), `@consent-guard/web`(데모 UI).
- 웹: React 19, Vite 7, 테스트는 tsx + `node:test`, e2e는 Playwright.
- 장부: canonical JSON + sha256(Node는 `node:crypto`, 브라우저는 WebCrypto; 패리티 테스트 포함).
- 온체인: Rust NEAR 계약(near-sdk 5), NEAR 테스트넷 공개 RPC의 `read_anchor` 뷰 호출.

### 6. 데모 방법

```bash
nvm use             # .nvmrc: Node 23.6 (그 이상이면 됨)
npm ci              # typecheck에 웹 워크스페이스의 @playwright/test 타입이 필요하므로 먼저 설치
npm test            # 119개 테스트: policy 26, proxy 10, ledger 35, integration 6, web 42
npm run typecheck   # 5개 워크스페이스 tsc
npm run demo:cli    # 5장면을 터미널에 출력, 마지막에 "ledger: 9 events, head faf3ef62b36a…" / "chain verified: OK"
npm run dev         # 웹 데모, http://localhost:5173/ (오프라인: http://localhost:5173/?mock=1)
npm run e2e         # Playwright e2e 6개: 5장면 순서대로 5개 + 목 모드(/?mock=1) 1개 (1280×800)
```

- 웹에서는 "+10분" 버튼으로만 시계가 움직이고, 승인·철회 버튼으로 장면 3·5를 진행합니다.
- `npm run e2e`는 오프라인으로 실행됩니다. Vite 서버를 `127.0.0.1:4174`에 `--strictPort`로 띄웠다 내리고(`E2E_PORT`로 변경), `reuseExistingServer: false`라서 4174가 이미 쓰이면 다른 서버에 붙지 않고 바로 실패합니다. 5장면 테스트는 `read_anchor` RPC를 `page.route`로 가로채 최종 장부 헤드(11건)를 돌려줍니다. 브라우저는 다운로드하지 않고 시스템 Chrome을 씁니다(`CHROME_PATH`로 변경). `verify:serve`(4173)와 동시에 돌려도 됩니다.
- **오프라인 목 모드**: 주소에 `?mock=1`을 붙이거나(재빌드 불필요) `VITE_ANCHOR_MOCK=1 npm run dev`로 띄우면 앵커 패널이 테스트넷 RPC를 호출하지 않고 라이브 앵커와 같은 값(11건, 헤드 `259dbd26…fa95b`, 블록 278,539,285)을 씁니다. 패널에 `목 RPC · 오프라인 대체` 배너가 항상 표시되며, 장면 5 뒤에 `일치 ✓`가 떠도 목이므로 발표 때 오프라인 대체라고 밝힙니다.
- 발표장 점검·포트·장애 대응은 [docs/RUNBOOK.md](RUNBOOK.md)에 있습니다.
- 정적 검증 페이지: `cd packages/ledger && npm run verify:serve` → http://127.0.0.1:4173/verify/ (이벤트 JSON을 붙여넣고 테스트넷 `read_anchor` 또는 붙여넣은 헤드와 비교).
- 백업 영상: [`demo/video/consent-guard-demo.webm`](../demo/video/consent-guard-demo.webm) (1280×800, 약 65초, 5장면).
- 장면별 스크린샷(1280×800): [`demo/screens/`](../demo/screens/) — [`01-initial.png`](../demo/screens/01-initial.png), [`02-deny-raw.png`](../demo/screens/02-deny-raw.png), [`03-approve-medical.png`](../demo/screens/03-approve-medical.png), [`04-plus-10min.png`](../demo/screens/04-plus-10min.png), [`05-revoke.png`](../demo/screens/05-revoke.png). 장면 2(`02-deny-raw.png`)는 `tax-agent` 계좌번호 거부 행과 감사 로그 #4를 빨간 테두리와 `원문 거부` 표시로 강조합니다. 재촬영: `npm run demo:screens`(포트 4175, 기본 오프라인 목).

### 7. 한계

- **AI 응답은 녹화된 fixture입니다.** `fixtures/ai-responses.json`의 답변을 request id로 재생하며 실제 모델을 호출하지 않습니다. API 키도 없습니다. 해당 id의 답변이 없으면 어댑터는 에러를 던지고 실모델로 넘어가지 않습니다(웹: `AI 응답 없음 (라이브 모델 호출 안 함)`). 화면에는 `recorded` 배지가 붙습니다. 답변 내용은 실제 모델 동작을 보여주지 않습니다.
- **앵커는 NEAR 테스트넷에 있으며 메인넷이 아닙니다.** 앵커 스크립트는 기본 dry-run이고, 실제 전송은 `--execute`와 `CONSENT_GUARD_ALLOW_TESTNET_WRITE=1`이 모두 있어야 합니다. 라이브 전송에 필요한 `near-api-js`는 기본 설치되지 않습니다.
- 앵커는 하나뿐입니다. 계약은 최신 앵커 하나만 보관하며, 현재 앵커는 웹 데모 최종 장부(11건)입니다. `demo:cli` 장부(9건, 승인 없이 +11분)는 시나리오가 달라 앵커와 비교되지 않습니다. fixture나 상태 전이가 바뀌면 최종 헤드가 달라져 재앵커가 필요합니다(`apps/web/test/demoScenario.test.ts`가 실패로 알려줌).
- 웹 앱은 앵커를 쓰지 않고 읽기만 합니다. 앵커는 Node 스크립트로 수동 실행합니다.
- 데모 데이터(카드 내역, 진료기록 등)는 모두 합성 데이터이며, 시계는 고정되어 있습니다.
- 장부와 앱 상태는 메모리에만 있습니다(`integration` 파이프라인은 in-memory, 웹은 React 상태). 사용자 인증이나 다중 사용자 기능은 없습니다.
- CLI 데모는 장면 3을 승인 대기까지만 보여줍니다. 승인 흐름은 웹에서만 진행됩니다.
- Rust 계약 테스트(`npm run test:contract`, cargo 7개)는 `npm test`에 포함되지 않습니다.

---

## English

### 1. One-liner

A consent gateway for AI agents: an agent only receives the fields the user consented to, for the consented purpose and time window, and every decision goes into a hash-chained audit log whose head is anchored on NEAR testnet.

### 2. Problem

AI agents (budgeting, tax, health, diet, ...) often receive a user's data wholesale. The user cannot easily see which fields went out, for what purpose, and until when; there is no way to confirm that a revocation takes effect immediately; and it is hard to prove after the fact that the access log was not altered. Some values, such as account numbers or resident registration numbers, should never be released raw under any consent.

### 3. Solution

Every agent request (`agentId`, `dataset`, `fields`, `purpose`) goes through a policy engine. The result is allow, deny, or pending (owner approval). Only on allow are the consented fields passed, masked where required, to the AI adapter. Every decision (grant / access / deny / pending / revoke) is recorded in a sha256 hash-chained ledger, and the final ledger head is anchored in a NEAR testnet contract.

The demo runs 5 scenes on a fixed clock from `fixtures/demo.json` (2026-11-20 20:00 KST). Reason strings are the policy engine's actual output (in Korean).

1. **Card transactions allowed, merchant masked** — `budget-agent` requests `category, amount, merchant` from `card_tx` → allowed, `merchant` delivered as `***`. `grant-card-budget 권한으로 허용(가림: merchant)`
2. **Raw account number blocked** — `tax-agent` requests `account_number` → denied regardless of consent, AI not called. `원문 금지 필드 요청: account_number`
3. **Medical record pending → user approves** — `health-agent` requests `medical_record` → pending. Approving in the web UI creates a 1-hour grant for exactly what was asked, and the request is re-evaluated and allowed.
4. **Allergy data for diet, 10 minutes → expired** — `diet-agent` requests only `allergy` for `diet_recommendation` → allowed. After "+10분" the follow-up request is denied: `diet-agent/medical_record: grant-allergy-diet 권한이 만료됨`.
5. **Card grant revoked → immediate deny** — right after `grant-card-budget` is revoked, the same agent's request is denied (`budget-agent/card_tx: grant-card-budget 권한이 철회됨`), AI not called. The audit log shows the hash-chain verification result and the on-chain anchor status panel.

### 4. Privacy guarantees

| Guarantee | How the code enforces it | Package |
| --- | --- | --- |
| Forbidden raw fields | If any of `FORBIDDEN_RAW_FIELDS` (`account_number`, `card_number`, `resident_id`, `ssn`, `cvv`, `password`) is requested, rule 2 of `evaluate` denies before any grant is checked. The web UI also has a separate `NEVER_DISPLAY` list so these values are never rendered. | `@consent-guard/policy` (`src/evaluate.ts`), `apps/web` (`src/App.tsx`) |
| Masking | Fields in a grant's `maskFields` are replaced with `***` by `applyMask`. A request containing any field outside the grant (`allowFields` + `maskFields`) is denied as a whole. `applyMask` returns no rows unless the decision is allow. The proxy forwards masked rows (at most `maxRows`) to the adapter only on allow. | `@consent-guard/policy` (`applyMask`), `@consent-guard/proxy` (`src/proxy.ts`) |
| Immediate revocation | When only grants with `revokedAt <= now` match, `evaluate` denies. The proxy never calls the adapter on deny; the integration tests check this via adapter call counts. | `@consent-guard/policy`, `@consent-guard/proxy`, `@consent-guard/integration` |
| Hash chain | Each event is hashed as sha256 of its canonical JSON (sorted keys, no whitespace) and linked by `prevHash` (genesis `"0".repeat(64)`). `verifyChain` returns the first bad index and the reason on tampering. The ledger stores field names only, not values. | `@consent-guard/ledger` (`src/core.js`) |
| On-chain anchor | The Rust NEAR contract (`contracts/anchor`) stores head hash and count via owner-only `anchor(head_hash, count)`, readable with `read_anchor()`. The web anchor panel reads `read_anchor` once and compares it with the live ledger's count and head. Tail truncation, which the chain alone cannot reveal, is caught by the anchor comparison. | `@consent-guard/ledger`, `apps/web` (`src/anchorStatus.ts`) |

Other rules applied by `evaluate`: reused request ids are denied (replay protection); purposes not in the grant are denied; `maxRangeDays` / `maxRows` overruns are denied; every grant has an `expiresAt` (TTL) and is denied once it passes; sensitive datasets (`medical_record`, `location`) without a grant go to pending.

**Final anchor** (`packages/ledger/README.md`, `apps/web/src/anchorConfig.ts`):

- Contract account: `consent-guard-anchor.tee-receipts-chamdom.testnet` (NEAR testnet)
- Anchor tx: `51udtFvQ4Po2E4Pj6H2gTTKAvK2VRKCGgBeAN7A25P2y`
- Block: 278,539,285 (2026-11-20 22:41:52 KST)
- Content: final ledger after all 5 web demo scenes, 11 events, head `259dbd26b973e4a7e8252488ce2a4d97d532f8355825b4edc3722c97b20fa95b`
- The first anchor tx `Gx1HfEQYRQh9RwLr1DJstmV6m6dJEaCFQ3RnXM39bHhE` (5-event sample fixture, block 278,537,646) is history only.

### 5. Tech stack

- Node >= 23.6 (root `.nvmrc` = `23.6`, `package.json` `engines` `>=23.6`), TypeScript run directly via type stripping (no build step), npm workspaces. Checked on Node 24.22.
- Packages: `@consent-guard/policy` (policy engine), `@consent-guard/proxy` (consent proxy, fixture LLM adapter), `@consent-guard/ledger` (hash chain, NEAR anchor contract and scripts, static verify page), `@consent-guard/integration` (proxy + ledger pipeline, `demo:cli`), `@consent-guard/web` (demo UI).
- Web: React 19, Vite 7; tests with tsx + `node:test`; e2e with Playwright.
- Ledger: canonical JSON + sha256 (`node:crypto` in Node, WebCrypto in the browser; covered by a parity test).
- On-chain: Rust NEAR contract (near-sdk 5); `read_anchor` view call over the public NEAR testnet RPC.

### 6. How to run the demo

```bash
nvm use             # .nvmrc: Node 23.6 (or newer)
npm ci              # install first: typecheck needs @playwright/test types from the web workspace
npm test            # 119 tests: policy 26, proxy 10, ledger 35, integration 6, web 42
npm run typecheck   # tsc across 5 workspaces
npm run demo:cli    # prints the 5 scenes, ends with "ledger: 9 events, head faf3ef62b36a…" / "chain verified: OK"
npm run dev         # web demo at http://localhost:5173/ (offline: http://localhost:5173/?mock=1)
npm run e2e         # Playwright e2e, 6 tests: 5 scenes in order + 1 mock-mode (/?mock=1) test (1280×800)
```

- In the web UI the clock only moves with the "+10분" button; scenes 3 and 5 use the approve and revoke buttons.
- `npm run e2e` runs offline: it starts and stops a Vite server on `127.0.0.1:4174` with `--strictPort` (override with `E2E_PORT`); with `reuseExistingServer: false` it fails fast instead of attaching to another server if 4174 is taken. The 5 scene tests intercept the `read_anchor` RPC with `page.route` to return the final ledger head (11 events). It uses the system Chrome instead of downloading a browser (override with `CHROME_PATH`). It can run alongside `verify:serve` (4173).
- **Offline mock mode**: append `?mock=1` to the URL (no rebuild) or start with `VITE_ANCHOR_MOCK=1 npm run dev`; the anchor panel then skips the testnet RPC and uses the same values as the live anchor (11 events, head `259dbd26…fa95b`, block 278,539,285). The panel always shows the `목 RPC · 오프라인 대체` ("mock RPC · offline stand-in") banner; the `일치 ✓` after scene 5 is mocked, so say it is the offline fallback when presenting.
- Venue checks, ports and troubleshooting: [docs/RUNBOOK.md](RUNBOOK.md).
- Static verify page: `cd packages/ledger && npm run verify:serve` → http://127.0.0.1:4173/verify/ (paste events JSON, compare against testnet `read_anchor` or a pasted head hash).
- Backup video: [`demo/video/consent-guard-demo.webm`](../demo/video/consent-guard-demo.webm) (1280×800, about 65 s, 5 scenes).
- Per-scene screenshots (1280×800): [`demo/screens/`](../demo/screens/) — [`01-initial.png`](../demo/screens/01-initial.png), [`02-deny-raw.png`](../demo/screens/02-deny-raw.png), [`03-approve-medical.png`](../demo/screens/03-approve-medical.png), [`04-plus-10min.png`](../demo/screens/04-plus-10min.png), [`05-revoke.png`](../demo/screens/05-revoke.png). Scene 2 (`02-deny-raw.png`) highlights the `tax-agent` account-number deny row and audit entry #4 with a red outline and a `원문 거부` ("raw denied") callout. Re-capture: `npm run demo:screens` (port 4175, offline mock by default).

### 7. Limitations

- **AI responses are recorded fixtures, not live model calls.** Answers from `fixtures/ai-responses.json` are replayed by request id; no model is called and there is no API key. If no answer exists for an id, the adapter throws and never falls back to a live model (web: `AI 응답 없음 (라이브 모델 호출 안 함)`). The UI shows a `recorded` badge. The answer text does not demonstrate real model behavior.
- **The anchor is on NEAR testnet, not mainnet.** The anchor script is dry-run by default; a real send needs both `--execute` and `CONSENT_GUARD_ALLOW_TESTNET_WRITE=1`. `near-api-js`, required for live sends, is not installed by default.
- There is a single anchor. The contract keeps only the latest anchor, which is the final web demo ledger (11 events). The `demo:cli` ledger (9 events, +11 min without approval) is a different scenario and is not compared with the anchor. Any fixture or state-transition change moves the final head and requires re-anchoring (`apps/web/test/demoScenario.test.ts` fails to flag it).
- The web app only reads the anchor; anchoring is a manual Node script step.
- All demo data (card transactions, medical records, ...) is synthetic, and the clock is fixed.
- Ledger and app state live in memory only (the `integration` pipeline is in-memory; the web app uses React state). There is no user authentication or multi-user support.
- The CLI demo shows scene 3 only up to pending; the approval flow is web-only.
- The Rust contract tests (`npm run test:contract`, 7 cargo tests) are not part of `npm test`.
