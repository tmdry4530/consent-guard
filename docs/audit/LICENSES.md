# 의존성 라이선스 목록 (U13)

날짜: 2026-11-20 (Asia/Seoul).  
대상: `package-lock.json`에 잠긴 패키지를 `node_modules`의 `package.json` `license` 필드로 확인했다 (오프라인). 워크스페이스 패키지(`@consent-guard/*`, 루트 `consent-guard`)는 제3자 의존성이 아니라 목록에서 뺐다. 이 레포의 패키지에는 `license` 필드가 없다. **루트 LICENSE 파일이나 package.json `license` 필드는 추가하지 않았다** (사용자가 정한다).

프로덕션 3개, 개발 122개, 합계 **125**개 (이름+버전 기준 중복 제거).

## 집계

전체:

| 라이선스 | 패키지 수 |
| --- | ---: |
| MIT | 113 |
| Apache-2.0 | 5 |
| ISC | 5 |
| BSD-3-Clause | 1 |
| CC-BY-4.0 | 1 |

프로덕션 (react, react-dom, scheduler):

| 라이선스 | 패키지 수 |
| --- | ---: |
| MIT | 3 |

개발:

| 라이선스 | 패키지 수 |
| --- | ---: |
| MIT | 110 |
| Apache-2.0 | 5 |
| ISC | 5 |
| BSD-3-Clause | 1 |
| CC-BY-4.0 | 1 |

## 플래그

- **카피레프트 (GPL / AGPL / LGPL / MPL): 없음.**
- **제3자 UNKNOWN / UNLICENSED: 없음.**
- `caniuse-lite@1.0.30001826`는 **CC-BY-4.0** (개발 의존성, browserslist 데이터). 카피레프트는 아니지만 MIT/Apache가 아니라서 여기에 적는다.

워크스페이스 패키지 `@consent-guard/policy`, `@consent-guard/ledger`, `@consent-guard/proxy`, `@consent-guard/integration`, `@consent-guard/web`는 라이선스 필드가 없다. 위에서 말한 대로 이번 작업에서 넣지 않았다.

## MIT가 아닌 제3자 패키지

| 패키지 | 버전 | 라이선스 | 구분 |
| --- | --- | --- | --- |
| @playwright/test | 1.65.1 | Apache-2.0 | dev |
| baseline-browser-mapping | 2.11.39 | Apache-2.0 | dev |
| caniuse-lite | 1.0.30001826 | CC-BY-4.0 | dev |
| electron-to-chromium | 1.5.492 | ISC | dev |
| lru-cache | 5.1.1 | ISC | dev |
| picocolors | 1.1.1 | ISC | dev |
| playwright | 1.65.1 | Apache-2.0 | dev |
| playwright-core | 1.65.1 | Apache-2.0 | dev |
| semver | 6.3.2 | ISC | dev |
| source-map-js | 1.2.4 | BSD-3-Clause | dev |
| typescript | 5.9.3 | Apache-2.0 | dev |
| yallist | 3.1.1 | ISC | dev |

## 전체 목록

| 패키지 | 버전 | 라이선스 | 구분 |
| --- | --- | --- | --- |
| @babel/code-frame | 7.29.7 | MIT | dev |
| @babel/compat-data | 7.29.7 | MIT | dev |
| @babel/core | 7.29.13 | MIT | dev |
| @babel/generator | 7.29.14 | MIT | dev |
| @babel/helper-compilation-targets | 7.29.13 | MIT | dev |
| @babel/helper-globals | 7.29.7 | MIT | dev |
| @babel/helper-module-imports | 7.29.7 | MIT | dev |
| @babel/helper-module-transforms | 7.29.14 | MIT | dev |
| @babel/helper-plugin-utils | 7.29.7 | MIT | dev |
| @babel/helper-string-parser | 7.29.14 | MIT | dev |
| @babel/helper-validator-identifier | 7.29.7 | MIT | dev |
| @babel/helper-validator-option | 7.29.7 | MIT | dev |
| @babel/helpers | 7.29.14 | MIT | dev |
| @babel/parser | 7.29.14 | MIT | dev |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT | dev |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT | dev |
| @babel/template | 7.29.7 | MIT | dev |
| @babel/traverse | 7.29.14 | MIT | dev |
| @babel/types | 7.29.14 | MIT | dev |
| @esbuild/aix-ppc64 | 0.28.2 | MIT | dev |
| @esbuild/android-arm | 0.28.2 | MIT | dev |
| @esbuild/android-arm64 | 0.28.2 | MIT | dev |
| @esbuild/android-x64 | 0.28.2 | MIT | dev |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | dev |
| @esbuild/darwin-x64 | 0.28.2 | MIT | dev |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | dev |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | dev |
| @esbuild/linux-arm | 0.28.2 | MIT | dev |
| @esbuild/linux-arm64 | 0.28.2 | MIT | dev |
| @esbuild/linux-ia32 | 0.28.2 | MIT | dev |
| @esbuild/linux-loong64 | 0.28.2 | MIT | dev |
| @esbuild/linux-mips64el | 0.28.2 | MIT | dev |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | dev |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | dev |
| @esbuild/linux-s390x | 0.28.2 | MIT | dev |
| @esbuild/linux-x64 | 0.28.2 | MIT | dev |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | dev |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | dev |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | dev |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | dev |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | dev |
| @esbuild/sunos-x64 | 0.28.2 | MIT | dev |
| @esbuild/win32-arm64 | 0.28.2 | MIT | dev |
| @esbuild/win32-ia32 | 0.28.2 | MIT | dev |
| @esbuild/win32-x64 | 0.28.2 | MIT | dev |
| @jridgewell/gen-mapping | 0.3.13 | MIT | dev |
| @jridgewell/remapping | 2.3.5 | MIT | dev |
| @jridgewell/resolve-uri | 3.1.3 | MIT | dev |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | dev |
| @jridgewell/trace-mapping | 0.3.31 | MIT | dev |
| @playwright/test | 1.65.1 | Apache-2.0 | dev |
| @rolldown/pluginutils | 1.0.0-rc.3 | MIT | dev |
| @rollup/rollup-android-arm-eabi | 4.68.7 | MIT | dev |
| @rollup/rollup-android-arm64 | 4.68.7 | MIT | dev |
| @rollup/rollup-android-x64 | 4.68.7 | MIT | dev |
| @rollup/rollup-darwin-arm64 | 4.68.7 | MIT | dev |
| @rollup/rollup-darwin-x64 | 4.68.7 | MIT | dev |
| @rollup/rollup-freebsd-arm64 | 4.68.7 | MIT | dev |
| @rollup/rollup-freebsd-x64 | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-arm-gnueabihf | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-arm-musleabihf | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-arm64-gnu | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-arm64-musl | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-loong64-gnu | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-loong64-musl | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-ppc64-gnu | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-ppc64-musl | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-riscv64-gnu | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-riscv64-musl | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-s390x-gnu | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-x64-gnu | 4.68.7 | MIT | dev |
| @rollup/rollup-linux-x64-musl | 4.68.7 | MIT | dev |
| @rollup/rollup-openbsd-x64 | 4.68.7 | MIT | dev |
| @rollup/rollup-openharmony-arm64 | 4.68.7 | MIT | dev |
| @rollup/rollup-win32-arm64-msvc | 4.68.7 | MIT | dev |
| @rollup/rollup-win32-ia32-msvc | 4.68.7 | MIT | dev |
| @rollup/rollup-win32-x64-gnu | 4.68.7 | MIT | dev |
| @rollup/rollup-win32-x64-msvc | 4.68.7 | MIT | dev |
| @types/babel__core | 7.20.5 | MIT | dev |
| @types/babel__generator | 7.27.0 | MIT | dev |
| @types/babel__template | 7.4.4 | MIT | dev |
| @types/babel__traverse | 7.28.0 | MIT | dev |
| @types/estree | 1.0.10 | MIT | dev |
| @types/node | 24.19.2 | MIT | dev |
| @types/react | 19.3.0 | MIT | dev |
| @types/react-dom | 19.3.0 | MIT | dev |
| @vitejs/plugin-react | 5.2.0 | MIT | dev |
| baseline-browser-mapping | 2.11.39 | Apache-2.0 | dev |
| browserslist | 4.29.6 | MIT | dev |
| caniuse-lite | 1.0.30001826 | CC-BY-4.0 | dev |
| convert-source-map | 2.0.0 | MIT | dev |
| csstype | 3.2.4 | MIT | dev |
| debug | 4.4.3 | MIT | dev |
| electron-to-chromium | 1.5.492 | ISC | dev |
| esbuild | 0.28.2 | MIT | dev |
| escalade | 3.2.0 | MIT | dev |
| fdir | 6.5.0 | MIT | dev |
| fsevents | 2.3.3 | MIT | dev |
| gensync | 1.0.0-beta.2 | MIT | dev |
| js-tokens | 4.0.0 | MIT | dev |
| jsesc | 3.1.0 | MIT | dev |
| json5 | 2.2.3 | MIT | dev |
| lru-cache | 5.1.1 | ISC | dev |
| ms | 2.1.3 | MIT | dev |
| nanoid | 3.3.20 | MIT | dev |
| node-releases | 2.0.65 | MIT | dev |
| picocolors | 1.1.1 | ISC | dev |
| picomatch | 4.0.7 | MIT | dev |
| playwright | 1.65.1 | Apache-2.0 | dev |
| playwright-core | 1.65.1 | Apache-2.0 | dev |
| postcss | 8.5.33 | MIT | dev |
| react | 19.3.1 | MIT | prod |
| react-dom | 19.3.1 | MIT | prod |
| react-refresh | 0.18.0 | MIT | dev |
| rollup | 4.68.7 | MIT | dev |
| scheduler | 0.28.0 | MIT | prod |
| semver | 6.3.2 | ISC | dev |
| source-map-js | 1.2.4 | BSD-3-Clause | dev |
| tinyglobby | 0.2.17 | MIT | dev |
| tsx | 4.23.15 | MIT | dev |
| typescript | 5.9.3 | Apache-2.0 | dev |
| undici-types | 7.24.6 | MIT | dev |
| update-browserslist-db | 1.4.0 | MIT | dev |
| vite | 7.3.8 | MIT | dev |
| yallist | 3.1.1 | ISC | dev |
