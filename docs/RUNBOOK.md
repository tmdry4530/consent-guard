# Consent Guard 발표 런북

발표장에서 데모를 띄우고, 인터넷이 끊겼을 때 대체하는 짧은 안내. API 키는 없고, 테스트넷에 아무 것도 쓰지 않는다. AI 답변은 녹화된 fixture다.

## 사전 점검

- Node **23.6 이상** (루트 `.nvmrc` / `package.json` `engines`). `demo:cli`가 TypeScript를 그대로 실행하므로 그 이하면 실패한다.
- 저장소 루트에서 **`npm ci`** (또는 `npm install`). typecheck는 웹 워크스페이스의 `@playwright/test` 타입이 필요해서, 설치 없이 돌리면 깨진다.
- 시스템 Chrome/Chromium. 기본 후보는 `/usr/bin/google-chrome`. 없으면 `CHROME_PATH`에 실행 파일 경로를 넣는다.
- 빠른 확인:

```bash
npm test             # 단위 테스트. 이 브랜치 기준 119개 (기존 116 + 목 모드 3)
npm run typecheck
npm run e2e          # 브라우저 테스트 6개 (장면 5개 + `/?mock=1` 오프라인 1개)
npm run demo:cli     # 한글 사유가 나오고 끝에 "chain verified: OK"
```

- **포트가 겹치지 않게.** 기본값:

  | 포트 | 쓰는 명령 | 비고 |
  | --- | --- | --- |
  | 5173 | `npm run dev` (Vite 개발 서버) | 정상 데모 |
  | 4173 | `vite preview`, `packages/ledger`의 `npm run verify:serve` | 이 둘은 서로 겹친다 |
  | 4174 | `npm run e2e`, `npm run demo:video` | 이 둘은 동시에 돌리지 말 것 |
  | 4175 | `npm run demo:screens` | 발표용 PNG 재촬영 |

  e2e는 **4174**에 `--strictPort`로 서버를 띄우고, 이미 떠 있는 서버를 재사용하지 않는다. 4174가 이미 쓰이면 잘못된 페이지를 치지 않고 바로 실패한다. `verify:serve`(4173)와 e2e는 동시에 해도 된다.

## 정상 데모 (라이브 테스트넷 앵커)

공개 RPC로 `read_anchor`만 읽는다. 키 없음, 쓰기 없음.

```bash
npm run dev          # http://localhost:5173/  # IPv4가 필요하면 `npm run dev -- --host 127.0.0.1`
# 빌드본을 쓰려면: npm run build && npm run preview   # http://127.0.0.1:4173/
```

브라우저를 1280×800에 가깝게 두고 다섯 장면을 진행한다.

1. 처음 화면 — 카드 내역 허용, 가맹점명 `***`, AI 배지 `recorded`. 앵커 패널은 `11건 중 N건 · 앵커 전`.
2. 계좌번호 원문 요청은 이미 `거부` (`원문 금지 필드 요청: account_number`).
3. 진료기록 대기 요청을 **허용**.
4. **+10분** — 알레르기 권한 만료, 후속 요청 거부.
5. 카드 권한 **철회** — 재요청 거부.

장면 5 뒤에 감사 로그가 `해시 체인 검증 ✓`, 앵커 패널이 `현재 장부 = 온체인 앵커 일치 ✓`, 11건, 헤드 `259dbd26…`, 블록 `#278,539,285`를 보여야 한다.

탐색기:

- 앵커 tx: https://testnet.nearblocks.io/txns/51udtFvQ4Po2E4Pj6H2gTTKAvK2VRKCGgBeAN7A25P2y
- 계약 `consent-guard-anchor.tee-receipts-chamdom.testnet`: https://testnet.nearblocks.io/address/consent-guard-anchor.tee-receipts-chamdom.testnet

## 발표장 인터넷이 끊겼을 때

### 1) 웹 앱 목 RPC (`/?mock=1`)

주소 끝에 `?mock=1`만 붙인다. 다시 빌드할 필요 없다.

```text
http://localhost:5173/?mock=1
```

개발 서버를 목으로 띄우려면 `VITE_ANCHOR_MOCK=1 npm run dev`.

패널에 **`목 RPC · 오프라인 대체`**가 보이고, 테스트넷 RPC를 호출하지 않는다. 넣는 값은 라이브 앵커와 같다 (헤드 `259dbd26b973e4a7e8252488ce2a4d97d532f8355825b4edc3722c97b20fa95b`, 11건, 블록 278,539,285). 다섯 장면은 그대로 진행하고, 장면 5 뒤에 `일치 ✓`가 뜬다. 다만 그건 목이니, 발표할 때 오프라인 대체라고 말한다.

e2e의 `page.route` 목과 같은 값이다. 앱 목 모드는 쿼리/환경 변수로 앱이 직접 켜는 것이고, e2e 5장면 테스트는 여전히 `page.route`로 RPC를 가로챈다.

### 2) 백업 영상

파일: [`demo/video/consent-guard-demo.webm`](../demo/video/consent-guard-demo.webm) (64.7초, 1,008,194바이트, 1280×800). 장면 5에서 `현재 장부 = 온체인 앵커 일치 ✓`로 끝난다.

재생: 파일 관리자나 브라우저에서 열거나,

```bash
xdg-open demo/video/consent-guard-demo.webm
```

다시 찍기 (시스템 Chrome, `ffmpeg`, 실제 RPC를 쓰려면 네트워크 필요):

```bash
DEMO_REAL_RPC=1 npm run demo:video -w @consent-guard/web
```

기본은 e2e와 같은 `page.route` 목으로 오프라인 녹화한다. 자체 Vite 서버를 **4174**에 띄우므로 `npm run e2e`와 동시에 돌리지 말 것. Chrome이 기본 경로에 없으면 `CHROME_PATH`를 지정한다. 장면별 PNG는 `EVIDENCE_DIR`로 추출되며, 기본값은 저장소 안 `evidence/demo-video/`다. 다른 곳에 쓰려면 그 변수를 덮어쓴다. `demo/video/`의 커밋된 영상은 덮어쓰지 않도록 주의한다.

### 3) 발표용 장면 캡처

[`demo/screens/`](../demo/screens/)에 장면 1~5 PNG(1280×800)가 있다. 슬라이드나 영상 대신 보여줄 수 있는 또 다른 오프라인 대체.

다시 찍으려면 (루트 `npm run demo:screens`, 기본 포트 **4175**, 기본은 오프라인 목, `DEMO_REAL_RPC=1`이면 실제 RPC):

```bash
npm run demo:screens
```

이 스크립트와 PNG는 U9(`dev2/screens`)에서 들어왔다. main `f01894a` 이후 브랜치에 있다.

## 문제 해결

| 증상 | 대응 |
| --- | --- |
| `demo:cli`가 TypeScript를 실행하지 못함 | Node를 23.6 이상으로. `.nvmrc` 참고 |
| typecheck가 `@playwright/test`를 찾지 못함 | 루트에서 `npm ci` 후 다시 |
| e2e / 영상 / 캡처가 Chrome을 찾지 못함 | Chrome/Chromium 설치, 또는 `CHROME_PATH`를 실행 파일로 |
| e2e가 4174 포트 사용 중으로 바로 실패 | `demo:video` 등과 겹친 것. 그 프로세스를 끄거나 `E2E_PORT`로 다른 포트를 지정 |
| preview와 `verify:serve`가 둘 다 4173 | 한 번에 하나만, 또는 `verify:serve`에 `--port` |
| 앵커 패널이 `앵커 확인 불가` (RPC 시간 초과·오프라인) | `/?mock=1`로 전환하거나 백업 영상·`demo/screens/`를 사용 |
| npm ci 중 esbuild `allowScripts` 경고 | 보통 빌드는 된다. `vite`/`esbuild`가 없으면 `npm ci`를 다시 |
| 예전 `screenshot.mjs`가 `/tmp/c9-video-tools/...`를 import | 박스 전용 경로였다. 이제는 `@playwright/test`를 쓴다 |

비밀 값, API 키, 테스트넷 쓰기는 이 런북에 없다. 앵커 확인은 공개 `read_anchor` 또는 목이다.
