# 비밀값 스캔 (U13)

날짜: 2026-11-20 (Asia/Seoul). 대상: 로컬 모든 브랜치의 전체 커밋 이력과 작업 트리.  
이 문서에는 **비밀값 자체를 적지 않는다.** 커밋 해시, 경로, 종류, 판정만 적는다.

## 방법

- `gitleaks` 8.21.2 (이미 설치됨). `gitleaks git --log-opts=--all --redact`와 `gitleaks dir`. 보고서에서 Secret/Match/Snippet 필드는 저장하지 않고 원본 보고서는 삭제했다.
- 모든 로컬 브랜치·태그 파일명 이력 (`git log --all --name-only`): `.env`, `.near-credentials`, `*.pem`, `id_rsa`, `private_key`, `credentials.json` 등.
- 내용 검색은 `git grep -l`만 사용했다 (매칭된 줄은 출력하지 않음). 패턴: PEM/OpenSSH private key 헤더, `ed25519:`/`secp256k1:` 키 형태, 흔한 토큰 접두어(`ghp_`, `sk-`, `AKIA` 등), JSON의 `private_key`/`secret_key` 필드, `.near-credentials` 경로 문자열.
- 네트워크 스캐너는 쓰지 않았다. 유료 도구를 설치하지 않았다.
- 저장소 밖의 테스트넷 키 파일은 **경로만 기록했고, 열지 않았다.**

스캔 규모: `git rev-list --all` 54개 커밋 (머지 제외 29개). gitleaks는 28개 커밋을 스캔했다고 보고했다 (머지 커밋을 건너뛴 것으로 보임). 파일명 이력은 고유 경로 105개.

## 판정: 실제 비밀값 없음

gitleaks 유출 0건. PEM/토큰/JSON 키 필드 패턴의 `git grep -l` 적중 0건. 이력에 `.env`·`.near-credentials`·키 파일명이 커밋된 적 없다. 루트 `.gitignore`는 `.env`, `.env.*`를 무시한다.

### 오탐·참고 (비밀값 아님)

아래는 소스·문서에 있는 **경로 문자열, 환경 변수 이름, 코드 식별자**이거나, 이미 공개된 온체인/장부 값이다.

| 종류 | 경로 (HEAD 또는 최초 도입) | 판정 |
| --- | --- | --- |
| `~/.near-credentials/...` 경로 문자열, 자격 파일을 저장소 밖에서만 읽는 코드 (`private_key` 필드명) | `packages/ledger/src/near.ts`, `packages/ledger/scripts/{anchor,deploy,create-account,cli-args}.mjs` (deploy는 `94948ba`부터, create-account는 `4f43009`부터) | 오탐. 키 값은 저장소에 없음 |
| `CONSENT_GUARD_ALLOW_TESTNET_WRITE` 플래그 이름 | 위 스크립트들과 `packages/ledger/README.md`, 루트 `README.md` | 오탐. 기본 dry-run, 실제 전송을 막는 스위치 이름 |
| `ed25519:` 접두어를 붙이는 키 생성 코드 (값을 저장소에 쓰지 않고 `~/.near-credentials`에만 기록) | `packages/ledger/scripts/create-account.mjs` | 오탐 |
| 공개 앵커 tx 해시, 테스트넷 계정 ID, 장부 헤드 sha256, 계약 `code_hash` | `README.md`, `packages/ledger/README.md`, `apps/web/src/anchorConfig.ts` 등 | 공개 값. 비밀 아님 |

이력 전체에서 같은 종류의 `.near-credentials` / `CONSENT_GUARD_ALLOW_TESTNET_WRITE` 문자열은 여러 커밋의 위 파일들에 반복된다. 모두 오탐으로 본다.

## 저장소 밖 테스트넷 키 파일

다음 경로는 저장소 밖에 있다. **내용을 열지 않았다.** git 이력·작업 트리에는 포함되지 않는다.

- 디렉터리: `/home/box/.near-credentials/`
- 이 프로젝트 계약 계정 파일: `/home/box/.near-credentials/testnet/consent-guard-anchor.tee-receipts-chamdom.testnet.json`
- 같은 `testnet/` 아래에 다른 계정의 `*.json`도 있으나, 모두 저장소 밖이며 이번 스캔에서 열지 않았다.

## 결론

**실제 비밀값 유출은 없다.** 서명 키는 문서대로 저장소 밖 `~/.near-credentials/testnet/`에만 두고, 커밋·로그·이 문서에 값을 남기지 않아야 한다.
