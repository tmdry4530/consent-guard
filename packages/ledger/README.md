# @consent-guard/ledger (U2)

Tamper-evident consent ledger: every `LedgerEvent` (grant / access / deny / pending / revoke) is chained by sha256, and the head hash is anchored on NEAR testnet. A static page re-verifies the chain in the browser and compares the head to the on-chain anchor.

Shared types come from `packages/policy/src/types.ts` (imported by relative path). **Types were not changed.**

## Layout

| Path | What |
| --- | --- |
| `src/core.js` (+ `core.d.ts`) | Browser-safe ESM, no `node:` imports: canonical JSON, hash chain, append/verify, anchor comparison, NEAR RPC view encode/decode. Used by Node and the verify page. |
| `src/adapter.js` (+ `adapter.d.ts`) | Web adapter used by `apps/web` via `@consent-guard/ledger/adapter` (`append`, `list`, `verifyChain`). |
| `src/index.ts` | Node entry: re-exports core, adds `nodeSha256Hex` (node:crypto) and `node.*` helpers bound to it. |
| `src/anchor.ts` | `createAnchorAdapter({ rpcUrl, contractId, accountId, credentialsPath, dryRun = true, fetchImpl })` → `anchor(head, count)`, `readAnchor()`. |
| `src/near.ts` | Defaults (RPC, contract id), credential-path existence check, opt-in live send. |
| `contracts/anchor/` | New minimal NEAR contract (Rust, near-sdk 5). Built wasm: `res/consent_guard_anchor.wasm`. |
| `scripts/` | `deploy.mjs`, `anchor.mjs` (dry-run by default), `serve-verify.mjs`, `screenshot-verify.mjs`. |
| `verify/` | Static verify page (`index.html`, `app.js`, `page-logic.js`) and `fixtures/sample-chain.json`. |

## Hash convention

- **Canonical JSON**: object keys sorted (`Array.prototype.sort`, UTF-16 code unit order), recursively; array order preserved; keys whose value is `undefined` omitted; no whitespace; primitives exactly as `JSON.stringify` encodes them. Non-finite numbers and bigints throw.
- **Event hash** = lowercase hex sha256 of the UTF-8 bytes of the canonical JSON of the event **with `hash` and `anchorTx` omitted**. `anchorTx` is filled in after the head is anchored; including it would change the hash and break the chain. This is a hashing rule, not a type change.
- **Genesis**: first event has `seq === 1` and `prevHash === GENESIS_PREV_HASH` / `GENESIS_HASH` (`"0".repeat(64)`). An empty chain verifies. Seq is 1-based (the web app relies on this).
- **Links**: `events[i].seq === i + 1` and `events[i].prevHash === events[i-1].hash`.

`verifyChain(events)` returns `{ ok: true }` or `{ ok: false, index, reason }`. `index` is the first event that is not a valid successor of the events before it; checks run in the order shape → hash recompute → seq → prevHash:

| Tamper | Reported index |
| --- | --- |
| field edit | the edited event (`hash mismatch`) |
| edit + recomputed hash | the next event (`prevHash mismatch`) |
| reorder | first moved position (`seq mismatch`) |
| delete | the event now in the deleted slot (`seq mismatch`) |
| insert, misnumbered/unlinked | the inserted position |
| insert, correctly numbered and linked | the next event (`seq mismatch`) |
| truncate the tail | not visible to the chain; caught by the anchor (`head-mismatch`) |

`appendEvent(events, input)` verifies `events` first (throws `LedgerChainError` with `index` if invalid), returns the new event, and never mutates `events`; `appendToChain` returns a new array. All chain functions take an optional `sha256` (default WebCrypto); `node.*` uses node:crypto.

## Why a new contract

The existing `tee-receipts-chamdom.testnet` is the TEE receipts contract (`get_owner`, `receipt_count`, `get_receipt`; `read_anchor`/`anchor` are MethodNotFound). Receipts are provider_tee records that need a registered signer and a valid TEE signature, so it cannot store an arbitrary ledger head. **Do not deploy to that account; it would overwrite the receipts contract** (`deploy.mjs` refuses it).

`contracts/anchor` keeps one latest anchor:

- `new(owner)`
- `anchor(head_hash, count)` — owner only; `head_hash` must be 64 hex chars (optional `0x`), stored lowercase without prefix; `count > 0`; records `block_height` and `timestamp_ms`; returns the anchor.
- `read_anchor() -> Option<{ head_hash, count, block_height, timestamp_ms }>`
- `get_owner()`

### Live testnet deployment (2026-11-20)

- Contract account: **`consent-guard-anchor.tee-receipts-chamdom.testnet`** (subaccount of `tee-receipts-chamdom.testnet`; the parent's receipts contract is unchanged). Owner = the contract account itself. Override with `--contract` / `CONSENT_GUARD_ANCHOR_CONTRACT_ID` and `--owner` / `CONSENT_GUARD_ANCHOR_OWNER_ID`.
- create-account tx: [`Egr1KaBsiDfVuTgq8TaRKMttNHyr97fcwd1Gd7LpWTcx`](https://testnet.nearblocks.io/txns/Egr1KaBsiDfVuTgq8TaRKMttNHyr97fcwd1Gd7LpWTcx)
- deploy + `new` tx: [`Goyrf4qdzTjQB8Pn73J9G7vFsQGtU5dccZ37SZXUrUyE`](https://testnet.nearblocks.io/txns/Goyrf4qdzTjQB8Pn73J9G7vFsQGtU5dccZ37SZXUrUyE) (account code_hash `4pLnb1fWbixBoE4MeeMTAFadeBaeiX9L4STasCvq7nic`)
- first anchor tx (sample fixture, 5 events, head `85c3a623b71c66b803e8dfdb20ff54fa09c3ceac8f2deca58a9b7d637c4228ce`, block 278,537,646): [`Gx1HfEQYRQh9RwLr1DJstmV6m6dJEaCFQ3RnXM39bHhE`](https://testnet.nearblocks.io/txns/Gx1HfEQYRQh9RwLr1DJstmV6m6dJEaCFQ3RnXM39bHhE)
- **current anchor tx** (final demo ledger: all 5 web demo scenes played to the end on the fixed demo clock, 11 events, head `259dbd26b973e4a7e8252488ce2a4d97d532f8355825b4edc3722c97b20fa95b`, block 278,539,285, 2026-11-20 22:41:52 KST): [`51udtFvQ4Po2E4Pj6H2gTTKAvK2VRKCGgBeAN7A25P2y`](https://testnet.nearblocks.io/txns/51udtFvQ4Po2E4Pj6H2gTTKAvK2VRKCGgBeAN7A25P2y). `read_anchor` now returns this head; the web audit log shows "11건 중 N건 · 앵커 전" until the demo reaches scene 5, then "현재 장부 = 온체인 앵커 일치 ✓".
- The signing key lives only in `~/.near-credentials/testnet/` (mode 0600) on the shared box and is never committed or printed.

Build/test (wasm is committed, so this is only needed after contract changes):

```bash
npm run test:contract     # cargo test (7 unit tests)
npm run build:contract    # cargo near build non-reproducible-wasm --no-abi → res/
```

`Cargo.lock` was resolved for rustc 1.85 (`CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback`, near-sdk 5.24). The committed wasm was built with rustup 1.86.0 + cargo-near 0.22 (wasm-opt post-step); sha256 `38b3bb1ab080dfd1201d4814fe63866985c15e23ebee572911aac6ed13038591`, 103918 bytes.

## Scripts — dry run by default

Nothing is signed or sent unless **both** `--execute` is passed **and** `CONSENT_GUARD_ALLOW_TESTNET_WRITE=1` is set. `--execute` without the env prints the dry-run summary and exits 1. The live path also needs the credentials file and `near-api-js@^7` (not installed by default). Private keys are never printed; scripts report only whether the credentials path exists.

```bash
cd packages/ledger
node scripts/deploy.mjs                     # DRY RUN: network, rpc, contract, credentials path exists?, wasm path/size/sha256, init args
node scripts/anchor.mjs                     # DRY RUN: verifies verify/fixtures/sample-chain.json, prints method + args
node scripts/anchor.mjs --events my.json --read   # also reads the current on-chain anchor (public RPC view)
node scripts/anchor.mjs --head <hex> --count 5
```

Env/flags: `--contract`/`CONSENT_GUARD_ANCHOR_CONTRACT_ID`, `--owner|--signer`/`CONSENT_GUARD_ANCHOR_OWNER_ID`, `--rpc`/`NEAR_RPC_URL` (default `https://rpc.testnet.near.org`; `https://rpc.testnet.fastnear.com` also works), `--credentials`/`NEAR_CREDENTIALS_FILE` (default `~/.near-credentials/testnet/<account>.json`).

The deploy dry run also prints the near-cli-rs `create-account` command used to create the subaccount from the parent. To re-anchor a new chain: `CONSENT_GUARD_ALLOW_TESTNET_WRITE=1 node scripts/anchor.mjs --events my.json --execute`, then `node scripts/anchor.mjs --read`.

## Verify page

```bash
cd packages/ledger && npm run verify:serve    # node:http only → http://127.0.0.1:4173/verify/
```

Paste events JSON, choose a file, or click **Load sample fixture**. Then either:
- **On-chain**: set the RPC URL and contract account; the page POSTs a `read_anchor` view call from the browser, or
- **Pasted head hash** (offline fallback, no contract needed): e.g. the `head_hash` printed by `scripts/anchor.mjs`.

The result is GREEN (`verified`) or RED, with the reason: no events, chain invalid at index *i* (the row is highlighted), head mismatch (recomputed vs anchor), count mismatch, or anchor unavailable. The page imports `../src/core.js` directly; there is no bundler and no build output.

Screenshots: `node scripts/screenshot-verify.mjs` (playwright-core from `/tmp/c9-video-tools`, `/usr/bin/google-chrome`) writes `verify-green.png` / `verify-red.png` to `/workspace/company/dev3-logs/nesa-ledger-evidence/` (`OUT_DIR` overrides).


## Use from the web app

`apps/web` imports `@consent-guard/ledger/adapter` (browser-safe ESM: `src/adapter.js` + `src/core.js`, no `node:` imports, so Vite bundles it as-is). For the richer API import `@consent-guard/ledger` or `@consent-guard/ledger/core`; there `verifyChain` returns `{ ok: true } | { ok: false, index, reason }`.

On-chain anchoring is not part of the web adapter. Use `scripts/anchor.mjs` (or `createAnchorAdapter`) from Node, and check the result on the verify page against the live contract above.

The audit log's anchor badge (`apps/web/src/anchorStatus.ts`) only reads: one public `read_anchor` view call, compared on every render with the live demo ledger's count and head. The canonical demo steps live in `apps/web/src/demoScenario.ts`; `apps/web/test/demoScenario.test.ts` asserts the final head equals the anchored constant in `apps/web/src/anchorConfig.ts`. If a fixture or state change moves the final head, that test fails; re-anchor with:

```bash
# from apps/web: export the final demo ledger, then dry-run / execute from packages/ledger
npx tsx -e 'import("./src/demoScenario.ts").then(async m=>{const f=(await m.runDemoScenario()).at(-1);require("fs").writeFileSync("/tmp/demo-final-ledger.json",JSON.stringify(f.ledger))})'
node scripts/anchor.mjs --events /tmp/demo-final-ledger.json --read
CONSENT_GUARD_ALLOW_TESTNET_WRITE=1 node scripts/anchor.mjs --events /tmp/demo-final-ledger.json --execute
```

then update `DEFAULT_ANCHOR_TX` / `EXPECTED_FINAL_*` in `anchorConfig.ts`.

## Tests

```bash
cd packages/ledger
npm test             # node:test: canonical JSON, chain + tamper cases, anchor adapter with mocked RPC, sha256 parity (node:crypto = WebCrypto = page)
npm run typecheck    # tsc -p .
```

Tests never touch the network or a signer; RPC is mocked via `fetchImpl`.
