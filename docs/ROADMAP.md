# Roadmap — 0.3.0 feature build-out

**Status: all seven features shipped in 0.3.0** (commits `598eb66` multichain,
`f74beb1` multi-account, `ef26f75` deal helpers, `71eeefe` EIP-5792/7702,
`c6a93eb` matchers, `accc7bf` WalletConnect, `fe4d409` real-wallet surface).
The hermetic suite is green; the env-gated WalletConnect-relay and
real-wallet smoke suites cover the rest. The former follow-up — the
real-wallet surface smoke was `fixme` pending selector stabilization — landed
with the 13.x speedup/stabilization pass (docs/REALWALLET_13X_PLAN.md):
generation is now an explicit configuration (no cross-generation selector
fallbacks), the surface tests are un-`fixme`'d and split into focused smoke
tests, and `npm run smoke:real-wallet` on the pinned 13.x build gates
releases (12.x stays supported best-effort).

All seven ecosystem-gap features from the 2026-06-09 library review were committed scope for 0.3.0.
Each had an implementation-ready design that survived adversarial feasibility review; the full designs
(API surfaces, behavior specs, risks, verified external facts, and the review corrections that are part
of the spec) live in [`reports/roadmap-scoping-2026-06-10.md`](../reports/roadmap-scoping-2026-06-10.md).
This file is the working digest: build order, binding rulings, and per-feature summaries.

## Build order

| Phase | What | Effort |
| --- | --- | --- |
| 1 | Controller substrate (chain registry, `handleExternalRequest`, event hooks, request mutex, canonical chain-id helpers) + **multichain** | ~5d |
| 2 | **multiaccount** (`_chainIsolation` snapshot owner generalized over the chains map, `createUser`) | 2.5–3d |
| 3 | Parallel tracks: **eip5792-7702** (A), **matchers** (B), **deal-helpers** (C), **realwallet-surface** (D — disjoint files, starts day 1) | 5–6d / 5.5–6.5d / 3.5d / 9–12d |
| 4 | **walletconnect** (sole consumer of the Phase-1 external-request hooks) | 5–6d |
| 5 | 0.3.0 integration: docs/API.md + one consolidated CHANGELOG migration list, testMatch union, final dist rebuild, dual-version real-wallet smoke + relay suite | 2–3d |

**Total:** ~37–44 focused engineer-days (including ~2–3d of cross-feature integration). Critical path substrate → multichain → multiaccount → walletconnect ≈ 13–15d; the rest parallelizes inside that window — two implementers land 0.3.0 in roughly 4–5 calendar weeks, three in 3–4. Dominant schedule risks: realwallet's dual-version smoke iteration latency and eip5792's error-path matrix.

## Features

### Multi-chain RPC routing (mock mode)

*Phase 1 — ~5d incl. shared substrate*

A consumer can register multiple chains on the mock wallet (each backed by its own Anvil node, RPC URL, or any RpcClient), and after a dapp-driven wallet_switchEthereumChain every forwarded RPC (reads, eth_sendTransaction, signing) is routed to the backend for the active chain instead of silently hitting the original node. The standard wagmi/RainbowKit flow — switch, catch 4902, wallet_addEthereumChain, verify eth_chainId — works end to end, switching to a registered-but-unbacked chain fails loudly (4901) instead of lying, transactions are recorded with the chain they executed on, and the bundled fixtures can spin up one extra Anvil per chain per worker with a chains map of ChainControllers alongside the existing chain fixture.

- **New dependencies:** none
- **Testing:** fully hermetic
- **Must fix before implementation:** resolve the wallet_switchEthereumChain ordering self-contradiction by adopting validate→4902→approve (ruling 2) with the deny-mode 4902 test and CHANGELOG note; drop the false 'bit-identical single-chain' regression claim and the goal text 'switching to an unbacked chain fails loudly 4901' (the switch succeeds, forwards fail); extras fixtures must spread { ...anvilOptions, ...spec } or ANVIL_RUNTIME=docker / tools-foundry setups break; fix the spec port band to unused sub-offsets; reframe the EIP-3085 claim ('only chainId is required' is wrong — the spec mandates rpcUrls rejection) and adopt rpcUrls-shape validation per ruling.

### Multi-account & two-user fixtures

*Phase 2 — 2.5–3d*

A consumer can start a mock-wallet test already connected with several Anvil accounts (via `walletOptions.accounts` or `accountIndexes`), switch the selected account mid-test with `wallet.switchAccount(address)` (MetaMask-faithful `accountsChanged` with the selected account first), and spin up a second user — its own browser context, page, and MockWalletController bound to a different account on the same worker Anvil — with one call to the new `createUser()` factory fixture. Misconfigured accounts (not signable by the backing node) fail fast at injection/setAccounts time with an actionable error instead of dying later inside the dapp with Anvil's opaque `-32602 No Signer available`, while `chain.impersonateAccount` flows keep working through an explicit escape hatch. Per-test snapshot/revert isolation now covers every user sharing the worker's Anvil, not just the primary `wallet` fixture.

- **New dependencies:** none
- **Testing:** fully hermetic
- **Must fix before implementation:** replace the lazy-once 'assertAccountsSignable' model with re-probe-on-miss 'known-to-node' semantics — anvil's eth_accounts includes impersonated accounts (foundry #5734), so the designed fail-fast error text, the allowUnsignable-required whale flow, and planned test (d) are all wrong as written. PrivateKeyRpcClient's local eth_accounts case MUST ship atomically with the injectMockProvider probe, or npm test performs a real Sepolia call via tests/live-fixtures.spec.ts (hermeticity violation masked by fail-open).

### EIP-5792 `wallet_sendCalls` + EIP-7702

*Phase 3 · Track A — 5–6d*

A consumer testing a 2026-era dapp (wagmi useSendCalls / viem sendCalls / AppKit batch flows) can run the full EIP-5792 journey against the hermetic mock wallet: capability probing per chain, batch submission with MetaMask-faithful validation and the exact 57xx error codes, deterministic batch status with real anvil receipts (100/200/400/500/600), all-or-nothing "atomic" execution emulated via evm_snapshot/evm_revert, and the existing approval-gating primitives (autoApprove, approveNext, holdNextRequest, simulateRejection) covering the whole batch as one user decision. Separately, ChainController gains EIP-7702 helpers (signAuthorization / delegate / revokeDelegation / getDelegation) so tests can put real type-4 delegations on anvil (verified working today on anvil 1.5.1 default hardfork), and PrivateKeyRpcClient stops dropping authorizationList and can sign authorizations for live-testnet 7702 tests. No competitor (Synpress v4, wallet-mock, dappwright) covers any of this.

- **New dependencies:** none
- **Testing:** fully hermetic
- **Must fix before implementation:** rewrite the atomic execution loop to be receipt-status-checked — anvil 1.5.1 mines reverting eth_sendTransaction with status 0x0 (verified; no submission error without a gas field), so the designed 'submission failure → evm_revert' path never fires for the dominant failure mode. Fetch each call's receipt synchronously under automine, evm_revert on status 0x0 or submission error, adopt the corrected status taxonomy (400 = nothing landed; 500 = all reverted/rolled back, including a mined-0x0 single-call non-atomic batch; 600 = mixed), and state an explicit blockTime>0 posture. Also invert dependsOn: ['multichain'] — eip5792 introduces the clientForChain seam that multichain consumes (resolved by the Phase 1 ordering anyway).

### Transaction assertion matchers

*Phase 3 · Track B — 5.5–6.5d*

After this ships, a consumer imports `expect` from `@marigoldlabs/web3-tester` (or `/matchers`) and writes hardhat-chai-matchers-style assertions directly in Playwright tests: `await expect(wallet.waitForNextTransaction()).toEmitEvent(chain, abi, 'Transfer', { args: { to: addr } })`, `toChangeBalance(s)`, `toChangeTokenBalance(s)`, `toBeReverted` / `toBeRevertedWith(reason|RegExp)` / `toBeRevertedWithCustomError(abi, name)`, and `toHaveTokenBalance` — with decoded-log failure diffs, plus a first-class `chain.waitForTransaction(hash, { abi })` that returns a receipt with decoded logs and an extracted revert reason. Matchers work identically in mock mode (ChainController), live mode (PrivateKeyRpcClient via a new `.client` getter), and real-wallet mode (any viem PublicClient), and compose with consumer matchers via `mergeExpects` or by spreading the exported `web3Matchers` record.

- **New dependencies:** none
- **Testing:** fully hermetic
- **Must fix before implementation:** (verification re-run standalone after the in-workflow verifier died; findings below.) Respecify wallet-rejection detection — the EIP-1193 `code` does not survive `page.evaluate` error serialization (Playwright rebuilds errors with name/message/stack only), so detect via message text / the `{ok:false, error}` envelope, and better, embed the code in the message in `serializeRpcError` so it survives for every consumer. Render undecodable logs by diffing `receipt.logs` against `parseEventLogs` output (viem silently drops foreign-topic0 logs regardless of `strict`). Use the shared `contracts/` pipeline's TestERC20 instead of its own committed bytecode. Prefer `debug_traceTransaction` for mined-revert reasons over parent-block replay (immune to multi-tx-block and timestamp-dependent divergence). Pin `.not`/args semantics for `toEmitEvent`, the matcher-vs-`waitForNextTransaction` timeout mismatch (5s vs 15s), and a 20-byte address-shape check on `toHaveTokenBalance`.

### ERC-20 deal + deployment helpers

*Phase 3 · Track C — 3.5d*

After this ships, a consumer arranging on-chain state for a test can do it in one line each: `chain.dealErc20(usdc, user, 1_000_000n * 10n ** 6n)` sets any standard ERC-20 balance (forge-std `deal` parity, including on an ANVIL_FORK_URL mainnet fork, with optional totalSupply adjustment and a clear typed failure for non-standard tokens); `chain.deployContract({ abi, bytecode, args })` deploys any artifact through Anvil's unlocked accounts and returns the mined address; `chain.deployErc20({ symbol: 'USDX' })` deploys a batteries-included precompiled test token (artifact committed in-repo like dist, no solc step for consumers); and `chain.getErc20Balance(token, user)` reads a balance without importing an ABI. All of it is hermetic against the per-worker Anvil, closing review findings "No ERC-20 deal / token seeding helper" (line 219) and "No contract deployment helper" (line 605) and the fork-recipe doc gap (line 167).

- **New dependencies:** none
- **Testing:** fully hermetic
- **Must fix before implementation:** resolve the step-5 vs risk-2 contradiction as restore→evict→rediscover-once on verification mismatch (the written throw path leaves pad32(amount) at a wrong slot), and treat cache-by-address as unsound across snapshot/revert (nonce reset reuses CREATE addresses) — cache hits must be verified with the same fallback. Switch discovery to eth_call stateDiff state-overrides (verified working on anvil 1.5.1, plain and fork) so probe writes never touch persistent state; convert setStorageAt bigint slots via toHex(slot, { size: 32 }) (viem takes number | Hash); make the CI artifact gate non-optional since risk 1's mitigation depends on it.

### WalletConnect / AppKit simulation

*Phase 4 — 5–6d*

A consumer can E2E-test the QR/WalletConnect connect path of an AppKit (or any WC v2) dapp without a phone or extension: a headless WalletConnect v2 wallet peer pairs with the dapp's modal (URI auto-extracted from AppKit's wui-qr-code, with a getUri override hook), approves the session with the fixture's accounts/chain, and answers every session_request by dispatching through the existing MockWalletController — so wallet.approveNext()/autoApprove()/holdNextRequest()/simulateRejection() and wallet.sentTransactions/waitForNextTransaction() work identically for WC traffic and injected traffic, in both mock-anvil and live-key modes. Ships as a separate './walletconnect' subpath with @walletconnect/* as optional peers, keeping the core at zero hard deps.

- **New dependencies:** @walletconnect/sign-client >=2.17 <3 — optional peerDependency (peerDependenciesMeta.optional=true) + devDependency; the WC v2 wallet-side protocol client, dynamically imported only inside the './walletconnect' subpath, @walletconnect/utils >=2.17 <3 — optional peer + devDependency; buildApprovedNamespaces (CAIP namespace negotiation is genuinely fiddly: AppKit dapps put everything in optionalNamespaces), getSdkError, parseUri. Declared explicitly because pnpm-strict consumers cannot rely on it being hoisted from sign-client's deps, @walletconnect/types >=2.17 <3 — optional peer + devDependency; types-only (erased at runtime), needed so our emitted d.ts and consumers' type-checking resolve CoreTypes/SessionTypes, Zero new hard runtime deps: core install remains dependency-free; dist/walletconnect.js references @walletconnect/* only via lazy dynamic import
- **Testing:** env-gated relay suite (WEB3_TESTER_WC_PROJECT_ID)
- **Must fix before implementation:** use the real sign-client API names respond({ topic, response }) and disconnect({ topic, reason }) — respondSessionRequest/disconnectSession are walletkit names that don't exist on SignClient; init with signConfig: { disableRequestQueue: true } or holdNextRequest silently starves every subsequent WC request (the hermetic suite is structurally blind to this); thread origin enforcement through handleExternalRequest context per ruling 11 (the design's allowedOrigins claim is currently false); fix the per-event removeAllListeners typing; add the session_authenticate never-subscribe invariant (One-Click Auth fallback) as explicit code + docs, not an accident.

### Real-wallet MetaMask surface completion

*Phase 3 · Track D (starts day 1) — 9–12d*

After this ships, a consumer driving the real MetaMask extension (12.23.1 or the default 13.34.1) through @marigoldlabs/web3-tester/real-wallet can do everything Synpress v4's MetaMask class does for account/token/settings/activity flows without touching the extension UI themselves: import an Anvil dev private key mid-test, create/switch/rename accounts, lock and unlock the wallet, clear activity/nonce data after restarting Anvil, enable test networks, import an ERC-20 manually or approve a dapp's wallet_watchAsset prompt, and confirm a transaction while waiting for it to appear confirmed in the activity tab — with the tx hash returned when readable. All methods span both pinned MetaMask UI generations via the existing fallback-selector-stack pattern, and account mutations made during cached-profile setup survive profile close on 13.x's debounced IndexedDB persistence.

- **New dependencies:** none
- **Testing:** opt-in smoke suite, both pinned MetaMask versions
- **Must fix before implementation:** the smoke test must not import anvil dev key #1 — 13.x multichain onboarding's SRP discovery derives that exact address from the same TEST_SEED (the repo's own smoke comment documents multi-account derivation), making importWalletFromPrivateKey throw the duplicate-account error. Import a random non-mnemonic key, fund via chain.setBalance, assert the address equals privateKeyToAccount(key).address. Additionally fix the expectedAddress staleness contract (getAccountAddress's fast-path at src/real-wallet.ts:902/560-571 returns stale results after switchAccount/import — and every customize hook runs in exactly that state) before writing the account methods.

## Binding consistency rulings

These were ruled once across all designs and supersede any conflicting per-design wording:

1. RULING (error code, unbacked chain): forwarded calls on a registered-but-unbacked chain throw providerError(4901, ...) — EIP-1193 'Chain Disconnected' — not MetaMask's real-world -32603. The library's existing convention (src/errors.ts providerError + the implemented 4001/4100/4200/4902 set) is EIP-1193-faithful named codes, and 4901 is in the same EIP-1193 table; emit it from the single clientForChain seam so a future fidelity swap is one line.
2. RULING (handler ordering, library-wide): param validation (-32602) → state/known-chain checks (4902, 5710, 5720, ...) → assertUserApproved → execution. This adopts the multichain design's written order over the current code (assertUserApproved runs first at src/mock-wallet-controller.ts:510/527), matches real MetaMask (4902 with no prompt shown), and is already the order eip5792's wallet_sendCalls specifies — so one rule covers both. Behavior change (deny-mode unknown-chain switch: 4001→4902) goes in the CHANGELOG with a pinning test.
3. RULING (event semantics): provider events fire only when the observable value changes — same-chain wallet_switchEthereumChain/switchNetwork emit no chainChanged; already-selected switchAccount emits no accountsChanged. setAccounts keeps its existing reconnect-and-emit behavior (src/mock-wallet-controller.ts:351-359) but the asymmetry vs switchAccount is pinned in docs/API.md and a test, per the multiaccount review.
4. RULING (one chain registry): multichain's chainBackends map IS eip5792's backedChainIds and IS the clientForChain seam — eip5792 must not create a private parallel set. backedChainIds is one public readonly Hex[] getter; every chain-id key everywhere (registry, knownChainIds, SentTransactionRecord.chainId, CallsBatchRecord.chainId, getCapabilities keys, eip155:N parsing in walletconnect) is canonical lowercase minimal hex produced by the rewritten normalizeChainId.
5. RULING (error-class convention): providerError(code) is reserved for errors that cross the page/WC bridge; test-side misconfiguration throws plain Error (multiaccount validation, fixture misuse, real-wallet failures); chain-side helpers may subclass Error for structured fields (Erc20DealError) but never mint provider codes — deal/deploy are cheatcodes outside the wallet. Revert matchers rethrow wallet 4001/4100 with a 'wallet approval failure, not a chain revert' hint, never swallow.
6. RULING (fixture option layering): fixture defaults → fixture-computed values (extras chains map, resolved accounts) → user walletOptions spread LAST and winning, matching existing src/fixtures.ts:101-107. walletOptions.chains merges as { ...fixtureExtras, ...userChains } (user wins per key; running extra Anvils are never silently orphaned — documented). createUser inherits the test's walletOptions as its base layer under per-call overrides; accounts/accountIndexes are owned by resolveAccounts and stripped before spreading into MockWalletControllerOptions.
7. RULING (snapshot ownership): _chainIsolation (test-scoped, memoized) is the single snapshot/revert owner and it snapshots/reverts EVERY ChainController in the chains map; wallet and createUser both depend on it. The multichain design's 'wallet fixture snapshots every controller' is superseded — implementing it there and moving it in Phase 2 would churn fixtures.ts twice.
8. RULING (account validation naming/semantics): the probe is assertAccountsKnownToNode (membership in node eth_accounts = sendable, NOT signable — anvil lists impersonated accounts), re-probes on miss instead of caching forever, and fails open on probe throw/timeout/empty-from-remote. The constructor-wide allowUnsignableAccounts option is dropped; a single per-call escape hatch remains for non-probing custom RpcClients. Documented separately: impersonated accounts pass validation but personal_sign/typed-data still fail node-side with -32602.
9. RULING (from-account enforcement): from ∈ currentAccounts (case-insensitive) → providerError(4100) applies to BOTH eth_sendTransaction and wallet_sendCalls, shipped together in 0.3.0 so consumers face one migration, not two breaking releases.
10. RULING (eip5792 defaults): mock fixtures default eip5792 enabled with atomic:'supported' (the library's MetaMask-faithful convention — 2026 MetaMask advertises it); live-fixtures default eip5792 DISABLED entirely (consistent with live mode's deny-by-default conservatism and capping the bare-approveNext blast radius at one real transaction), overridable via walletOptions. This resolves the design's open question and replaces its atomic:'unsupported' live default.
11. RULING (WC gating identity): WalletConnect session proposals gate as a synthetic eth_requestAccounts dispatch (reuses APPROVAL_GATED_METHODS, approveNext match callbacks receive the proposal payload for targeting) — no new method id. Origin scoping is enforced for real via handleExternalRequest(request, { origin }) → assertOriginAllowed with a documented opt-out, so the live-mode allowedOrigins claim becomes true instead of being stricken.
12. RULING (export surface): every new module gets a './name' subpath (matchers, transactions, walletconnect, erc20) per the package.json convention; module-level values/types are also re-exported from src/index.ts (the existing idiom — index already re-exports real-wallet-cache, which has no subpath). Fixture-scoped types stay on their fixture subpaths ONLY (index.ts exports zero fixture types today): UserSession/CreateUserOptions/CreateUser export from /fixtures, not root — overruling the multiaccount design's index.ts plan. realwallet's waitForExtensionStatePersisted and RealWalletToken must be added to index.ts; matchers' pure helpers (normalizePrivateKey etc. analogues) stay unexported-internal since tests import from ../src directly.
13. RULING (env gating + naming): WEB3_TESTER_WC_PROJECT_ID approved, mirroring WEB3_TESTER_REAL_WALLET_SMOKE; all non-hermetic suites live in the library project with self-skip guards and never gate CI. Synpress-parity names win on the real-wallet surface (switchAccount/addNewAccount/importWalletFromPrivateKey/resetAccount/lock/unlock), with aliases only where Synpress's name is unclear (addNewToken → approveAddToken). Mock-side switchAccount(address) vs real-side switchAccount(nameOrAddress) coexist — different surfaces, documented difference.
14. RULING (port bands): primary (ANVIL_PORT ?? 8645) + workerIndex; fixture extras at +1000 + workerIndex*20 + index with the workerIndex<1000 bound stated (not 'cannot collide'); spec-managed anvils use base + workerIndex*20 + subOffset with unique sub-offsets registered in a comment table next to workerPort (anvil.spec 0-3, private-key-rpc-client 10-12, multichain specs 13+) — matching the in-repo convention the review identified.

## Shared infrastructure (built once, in Phase 1 unless noted)

- Canonical chain-id helpers in mock-wallet-controller.ts (or a small shared module): normalizeChainId via toHex(BigInt(...)) plus parse wrappers that throw providerError(-32602) for dapp params and plain Error for constructor/config input. Consumers: multichain routing keys, eip5792 5710/getCapabilities keys, walletconnect eip155:N chainIds, fixtures duplicate-chain guards. BigInt('garbage') throws SyntaxError — wrapping must be explicit code.
- chainBackends registry + clientForChain(chainId)/activeRpcClient + public backedChainIds + the 4901 constant on MockWalletController — the single seam multichain (routing), eip5792 (batch execution + capability advertisement), and walletconnect (per-chain session_request dispatch) all route through. Build in Phase 1, never duplicated.
- handleExternalRequest(request, context?: { origin }) threading assertOriginAllowed (today only the exposeBinding handler enforces origins, src/mock-wallet-controller.ts:231-247) + onProviderEvent(listener) with fire-and-forget node-side dispatch. Built in Phase 1 for walletconnect; also the integration point for any future non-injected transport.
- Controller promise-chain mutex serializing forwarded sends and snapshot-scoped batch execution — required by eip5792's evm_snapshot/evm_revert window (exposeBinding handlers run concurrently), and protects multichain switch+forward interleavings. A few lines; shared, not per-feature.
- Bounded RPC probe utility (AbortSignal.timeout / Promise.race wrapper) — multichain's trustDappRpcUrls eth_chainId probe (5s), multiaccount's eth_accounts node probe (2-3s, fail-open on timeout since custom RpcClients may hang rather than throw). Note: AnvilInstance.reportedChainId is private and timeout-less — this is new code, not reuse.
- _chainIsolation fixture + resolveAccounts helper in fixtures.ts — single snapshot/revert owner spanning the chains map, shared by wallet, createUser, and any future fixture that mutates chain state; createUser/wallet take rpcClient+chainId from the identical fixture inputs (no second source of truth).
- src/transactions.ts decoding layer (ReadClient structural type, waitForDecodedTransaction, extractRevertInfo, bigint-aware stringify/equality) — consumed by matchers, ChainController.waitForTransaction, eip5792's getCallsStatus receipt fetch + spec-field projection, and the real-wallet smoke's tx-hash cross-check via chain.client.
- PrivateKeyRpcClient additions coordinated as one file-owner bundle: public client getter (matchers), local eth_accounts case (multiaccount — atomic with the probe), authorizationList hex→number mapping + signAuthorization (7702). Three tracks touch this file; one owner avoids three conflicting PRs.
- One contracts pipeline: contracts/*.sol + contracts/foundry.toml (pinned solc, bytecode_hash none, cbor_metadata false) + scripts/build-contracts.mjs emitting committed src/contracts/*.ts and tests/contracts/fixtures.ts, with a NON-optional CI recompile gate mirroring the dist gate. deal-helpers' TestERC20/VyperLayoutToken/SharesToken and matchers' Emitter/Reverter token fixtures all come from this generator — matchers' MiniToken should simply BE TestERC20, not a second artifact path.
- Test scaffolding shared across specs: a counting/recording RpcClient wrapper (deal-helpers cache assertions, multichain routing assertions, multiaccount probe-traffic assertions) and the documented port-band sub-offset table next to workerPort in fixtures.ts.
- Release machinery used once: consolidated 0.3.0 CHANGELOG behavior-change list, playwright.config testMatch union (explicit allowlist — every new spec must be added or it silently never runs), rebase-then-rebuild dist discipline against the CI freshness gate.

## Cross-cutting gate

- Cross-cutting gate: the consistency rulings that change shared semantics (registry unification, _chainIsolation ownership, validation-before-approval ordering, canonical hex chain ids, live eip5792-off default, fixture option layering) must be agreed and reflected in each design BEFORE any controller PR opens — four features edit mock-wallet-controller.ts and two rewrite fixtures.ts, and divergence here is the largest integration risk in the plan.

## Non-goals (declared)

- **Phantom (or other non-MetaMask) real-wallet adapters** — the RealWalletController interface stays the seam; a second adapter is future validation work, not 0.3.0 scope.
- **Cypress runner support** — this library is Playwright-native by design.
