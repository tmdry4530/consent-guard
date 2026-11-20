# @consent-guard/ledger (U2)

Tamper-evident consent ledger: every `LedgerEvent` (grant / access / deny / pending / revoke) is chained by sha256, and the head hash is anchored on NEAR testnet. A static page re-verifies the chain in the browser and compares the head to the on-chain anchor.

Shared types come from `packages/policy/src/types.ts` (imported by relative path). **Types were not changed.**

## Layout

| Path | What |
| --- | --- |
| `src/core.js` (+ `core.d.ts`) | Browser-safe ESM, no `node:` imports: canonical JSON, hash chain, append/verify, anchor comparison, NEAR RPC view encode/decode. Used by Node and the verify page. |
| `src/adapter.js` (+ `adapter.d.ts`) | Drop-in for `apps/web/src/ledgerAdapter.ts` (`verifyChain` returns boolean). |
| `src/index.ts` | Node entry: re-exports core, adds `nodeSha256Hex` (node:crypto) and `node.*` helpers bound to it. |
| `src/anchor.ts` | `createAnchorAdapter({ rpcUrl, contractId, accountId, credentialsPath, dryRun = true, fetchImpl })` → `anchor(head, count)`, `readAnchor()`. |
| `src/near.ts` | Defaults (RPC, contract id), credential-path existence check, opt-in live send. |
| `contracts/anchor/` | New minimal NEAR contract (Rust, near-sdk 5). Built wasm: `res/consent_guard_anchor.wasm`. |
| `scripts/` | `deploy.mjs`, `anchor.mjs` (dry-run by default), `serve-verify.mjs`, `screenshot-verify.mjs`. |
| `verify/` | Static verify page (`index.html`, `app.js`, `page-logic.js`) and `fixtures/sample-chain.json`. |

## Hash convention

- **Canonical JSON**: object keys sorted (`Array.prototype.sort`, UTF-16 code unit order), recursively; array order preserved; keys whose value is `undefined` omitted; no whitespace; primitives exactly as `JSON.stringify` encodes them. Non-finite numbers and bigints throw.
- **Event hash** = lowercase hex sha256 of the UTF-8 bytes of the canonical JSON of the event **with `hash` and `anchorTx` omitted**. `anchorTx` is filled in after the head is anchored; including it would change the hash and break the chain. This is a hashing rule, not a type change.
- **Genesis**: first event has `seq === 1` and `prevHash === GENESIS_PREV_HASH` / `GENESIS_HASH` (`"0".repeat(64)`). An empty chain verifies. Seq is 1-based so it matches the already-merged U3 web mock (`apps/web/src/ledgerAdapter.ts`).
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

Proposed account: **`consent-guard-anchor.tee-receipts-chamdom.testnet`** (subaccount; override with `--contract` / `CONSENT_GUARD_ANCHOR_CONTRACT_ID`). EL creates and deploys it at integration; owner defaults to the contract account itself (`--owner` / `CONSENT_GUARD_ANCHOR_OWNER_ID`).

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

The deploy dry run prints a near-cli-rs `create-account` command for creating the subaccount from the parent. That command was not run, so check it against the installed near CLI.

## Verify page

```bash
cd packages/ledger && npm run verify:serve    # node:http only → http://127.0.0.1:4173/verify/
```

Paste events JSON, choose a file, or click **Load sample fixture**. Then either:
- **On-chain**: set the RPC URL and contract account; the page POSTs a `read_anchor` view call from the browser, or
- **Pasted head hash** (offline fallback, no contract needed): e.g. the `head_hash` printed by `scripts/anchor.mjs`.

The result is GREEN (`verified`) or RED, with the reason: no events, chain invalid at index *i* (the row is highlighted), head mismatch (recomputed vs anchor), count mismatch, or anchor unavailable. The page imports `../src/core.js` directly; there is no bundler and no build output.

Screenshots: `node scripts/screenshot-verify.mjs` (playwright-core from `/tmp/c9-video-tools`, `/usr/bin/google-chrome`) writes `verify-green.png` / `verify-red.png` to `/workspace/company/dev3-logs/nesa-ledger-evidence/` (`OUT_DIR` overrides).


## Swap for U3 `apps/web/src/ledgerAdapter.ts`

The web UI (dev2/web, merged) currently imports a mock from `./ledgerAdapter`. `@consent-guard/ledger` has no extra runtime deps (WebCrypto in the browser, `node:crypto` in Node). After this package is merged, the mock can be replaced as follows.

Recommended (one import change; signatures match the mock, including `verifyChain(): Promise<boolean>` and 1-based seq):

1. In `apps/web/package.json`, add a workspace dependency: `"@consent-guard/ledger": "*"`.
2. Replace every `from "./ledgerAdapter"` with `from "@consent-guard/ledger/adapter"` in:
   - `apps/web/src/App.tsx`
   - `apps/web/src/main.tsx`
   - `apps/web/src/state.ts` (type-only `LedgerInput`)
   - `apps/web/test/ledger.test.ts`
3. Delete `apps/web/src/ledgerAdapter.ts`.
4. Run `npm install` at the repo root (so the workspace link is added to the existing lockfile — this package adds no new npm dependencies) and `npm test` / `npm run typecheck` in `apps/web`.

The adapter entry is browser-safe ESM (`src/adapter.js` + `src/core.js`, no `node:` imports), so Vite can bundle it as-is.

If you would rather import the richer root API (`@consent-guard/ledger` or `@consent-guard/ledger/core`):

- `append`, `list`, `GENESIS_HASH`, `LedgerInput` / `LedgerEventInput`, `hashEvent`, `createEvent` are the same.
- Root `verifyChain` returns `{ ok: true } | { ok: false, index, reason }` instead of a boolean (EL's U2 contract, used by the verify page). In `App.tsx` change `verifyChain(ledger).then((ok) => live && setChainOk(ok))` to `verifyChain(ledger).then((r) => live && setChainOk(r.ok))`, and in `test/ledger.test.ts` assert `(await verifyChain(chain)).ok` instead of the boolean.

Near anchoring is not part of the mock adapter. To show `anchorTx` on events later, call `createAnchorAdapter({ dryRun: true })` from the Node side or paste the head on the verify page; the web app can keep using recorded fixtures until EL runs the real testnet deploy.

## Tests

```bash
cd packages/ledger
npm test             # node:test: canonical JSON, chain + tamper cases, anchor adapter with mocked RPC, sha256 parity (node:crypto = WebCrypto = page)
npm run typecheck    # tsc -p .
```

Tests never touch the network or a signer; RPC is mocked via `fetchImpl`.
