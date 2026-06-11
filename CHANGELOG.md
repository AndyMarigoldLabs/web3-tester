# Changelog

## 0.4.0 — 2026-06-11 — real-wallet 13.x hardening

Speed and usability pass on the real-MetaMask adapter, validated live against
13.34.1 (see `docs/REALWALLET_13X_PLAN.md`).

**Breaking (real-wallet only):** the headed/headless choice is now mandatory.
`launchRealWallet`, `buildWalletProfile`, and the `realWallet` fixture throw
unless `headless` is set explicitly or `WEB3_TESTER_REAL_WALLET_HEADLESS` is
`true`/`false`. Launches now use Playwright's `channel: 'chromium'` (the full
Chromium build — run `npx playwright install chromium`) instead of injecting
`--headless=new`.

**Configuration, not fallbacks:** the MetaMask UI generation (`12x`/`13x`) is
derived from the extension manifest and selectable via the new `generation`
option. Only the configured generation's selectors are driven — the other
generation is no longer probed as a fallback, removing dead cross-generation
selector probes. 13.34.1 gates releases (`npm run smoke:real-wallet`); 12.x is
supported best-effort.

**Fixes against 13.34.1's redesigned surfaces** (each live-validated, even
against the well-known anvil seed whose ~700 SRP-discovered accounts make the
picker virtualized and the account-tree sync race account creation):
- `importWalletFromPrivateKey` — no more 30s dead-probe; routes back to the
  wallet home afterward (13.x parks the SPA on the choose-wallet-type page).
- `addNewAccount` — creates on the wallet details page (account creation moved
  off the picker), settling the account tree and retrying the background
  create across navigations, detecting the new account by its exact testid.
- `switchAccount` / `renameAccount` — narrow the virtualized picker via its
  search box and match the exact display name (or the imported account's
  address-derived cell); rename a freshly created account via the
  account-details route.
- `importToken` — walks the `Manage tokens` → custom-token-import page flow.
- `toggleShowTestNetworks` — uses the standalone `#/networks` page (the picker
  popover hides the toggle) and force-flips the hidden screen-reader checkbox;
  enabling it reveals the built-in testnets (Sepolia et al.).

Faster cold builds: pruned cache subtrees in profile clones and replaced fixed
IndexedDB-flush dwells with state-based polling.

**Live smoke (13.34.1):** the full `npm run smoke:real-wallet` surface passes
— full journey, account create/switch/rename, lock/unlock, importToken,
confirmTransactionAndWaitForMining, watchAsset approve/reject, resetAccount,
test-networks enable, private-key import, and the customize-hook persistence
trap (a custom-network add — the cleanest core-state mutation; private-key
imports persist best-effort, their encrypted keyring landing in a delayed
wave). The wallet methods carry internal retries for MetaMask's account-tree
sync race; the runner is single-worker (the live UI flakes a different test
each run when two MetaMask instances contend for CPU) with `--retries=1` as a
backstop. 12.23.1 is supported best-effort as an explicit `generation`
configuration (`WEB3_TESTER_METAMASK_VERSION=12.23.1`): the same surface
passes there, except the 13.x-only test-networks-enable test (skipped) and
`importToken`, whose older 12.x modal has an unreliable metadata-load (the
"Next" button intermittently stays disabled) — `importToken` is best-effort
on 12.x and its smoke test is skipped there.

## 0.3.0 — 2026-06-10

The ecosystem build-out: multi-chain mock routing, multi-account & two-user
fixtures, EIP-5792 batch calls + EIP-7702, transaction assertion matchers,
ERC-20 deal/deployment helpers, WalletConnect/AppKit simulation, and the
real-wallet MetaMask account/token/settings surface. Designed and
adversarially verified up front (`reports/roadmap-scoping-2026-06-10.md`),
then built in seven phases.

**Migration (mock-mode behavior changes):** forwarded calls after switching
to a backend-less chain now throw `4901`; `wallet_switchEthereumChain`
validates before prompting (unknown chain → `4902`, not `4001`);
`wallet_addEthereumChain` requires `rpcUrls`; chain ids canonicalize to
lowercase minimal hex; same-chain switches emit no `chainChanged`; wallet
accounts are validated against the node's signers; `eth_sendTransaction`
with an unauthorized `from` throws `4100`; EIP-5792 is advertised by default
(`eip5792: false` restores the legacy `4200`). Live fixtures keep EIP-5792
off. The extended `expect` type widens from `Expect<{}>` (additive at
runtime).

### Added — real-wallet MetaMask surface (0.3.0)

- `RealWalletController` reaches Synpress v4 parity for account/token/
  settings/activity flows across MetaMask 12.23.1 and 13.34.1:
  `importWalletFromPrivateKey`, `addNewAccount`, `switchAccount`,
  `renameAccount`, `lock`/`unlock`, `resetAccount`, `toggleShowTestNetworks`,
  `importToken`, `approveAddToken`/`addNewToken`/`rejectAddToken`,
  `rejectTokenPermission`, and `confirmTransactionAndWaitForMining`
  (returns a best-effort `txHash`). Selectors are bundle-verified against
  both pinned builds.
- `buildWalletProfile({ customize })` / `realWalletOptions.profileSetup`:
  one-time profile customization (import keys, add accounts) baked into the
  cached profile, with `waitForExtensionStatePersisted` waiting for 13.x's
  debounced IndexedDB flush so mutations survive profile close. The build
  lock now heartbeats so a long customize run is not stolen as stale.
- The opt-in smoke suite's full-journey test validates the existing flows;
  the new account/token/settings surface tests are present but `fixme` until
  the dual-version live selector stabilization pass (live MetaMask UI is
  timing-sensitive and feature-flag dependent).

### Added — WalletConnect / AppKit simulation (0.3.0)

- `@marigoldlabs/web3-tester/walletconnect`: `WalletConnectWallet` pairs with
  a dapp's AppKit/WC v2 modal (URI auto-extracted from `wui-qr-code`, with
  `selector`/`getUri` escape hatches) and dispatches every session proposal
  (as a synthetic `eth_requestAccounts`) and `session_request` through the
  `MockWalletController` — approval gating, origin scoping
  (verifyContext-based, `enforceOrigins: false` opt-out), and transaction
  recording govern WC traffic exactly like injected traffic. Wallet events
  push to sessions; errors cross the relay verbatim; SignClient runs with
  in-memory storage and `disableRequestQueue` (holds cannot starve later
  requests); One-Click Auth dapps take the `wc_sessionPropose` fallback by
  invariant. `@walletconnect/sign-client`/`utils`/`types` are optional peers
  (>=2.17 <3) — the core install stays dependency-free; they are also
  devDependencies here, which git-installs will fetch (documented cost).
- The relay suite is opt-in via `WEB3_TESTER_WC_PROJECT_ID`; gating, error
  mapping, namespaces, and URI extraction are covered hermetically.
- `MockWalletController.handleExternalRequest` gains a documented
  `bypassOriginCheck` opt-out for transports that cannot attest origins.

### Added — transaction assertion matchers (0.3.0)

- The `expect` re-exported by every fixture module is now extended with
  web3 matchers (hardhat-chai-matchers parity): `toEmitEvent` (named/
  positional/predicate args, `anyValue`, `count`), `toChangeBalance(s)`
  (sender fee excluded by default, `includeFee` opt-in),
  `toChangeTokenBalance(s)`, `toBeReverted`/`toBeRevertedWith(string|RegExp)`/
  `toBeRevertedWithCustomError`/`toBeRevertedWithPanic`, and
  `toHaveTokenBalance` — with decoded-event failure messages. Wallet
  approval failures are detected by message text (EIP-1193 codes do not
  survive `page.evaluate` serialization) and rethrown with a hint, never
  mistaken for reverts.
- `chain.waitForTransaction(hash, { abi })` returns the receipt with decoded
  logs and a recovered revert reason (parent-block replay with a
  `debug_traceTransaction` fallback); `PrivateKeyRpcClient.client` exposes
  the read-only viem client so live mode satisfies `ChainLike`.
- New `./matchers` and `./transactions` subpaths (`web3Matchers`, `anyValue`,
  `extractRevertInfo`, `waitForDecodedTransaction`); compose with consumer
  matchers via `mergeExpects` or matcher spread. The re-exported `expect`'s
  type widens from `Expect<{}>` — purely additive at runtime.

### Added — EIP-5792 batch calls + EIP-7702 (0.3.0)

- Mock wallet implements the four EIP-5792 methods with Final-spec error
  codes (57xx) and status codes (100/200/400/500/600): per-chain
  `wallet_getCapabilities`, `wallet_sendCalls` with one approval gating the
  whole batch, receipt-status-checked execution (anvil mines reverts as
  status 0x0 — the loop verifies each receipt) with `evm_snapshot`/`revert`
  atomic rollback, `wallet_getCallsStatus` with real projected receipts, and
  `wallet_showCallsStatus` recording. `wallet.sentCallBatches`,
  `simulateAtomicUpgradeRejection()`, and the `ready`→`supported` upgrade
  emulate MetaMask's EOA-upgrade flow. Configure via
  `walletOptions.eip5792`; no competitor covers this.
- `ChainController` EIP-7702 helpers: `signAuthorization`, `delegate`,
  `revokeDelegation`, `getDelegation` — real type-4 delegations on anvil's
  default hardfork, hermetically.
- `PrivateKeyRpcClient.signAuthorization()` and `authorizationList`
  passthrough in `eth_sendTransaction` (previously silently dropped).

Behavior changes (0.3.0 migration):

- EIP-5792 is advertised by default in mock mode: dapps probing
  `wallet_getCapabilities` (wagmi/viem do automatically) now take the
  `sendCalls` path instead of falling back to `eth_sendTransaction`. Pass
  `walletOptions: { eip5792: false }` for the legacy posture. Live fixtures
  keep it disabled by default.

### Added — ERC-20 deal + deployment helpers (0.3.0)

- `chain.dealErc20(token, account, amount, options?)` — forge-std `deal`
  parity: balance-slot discovery via `eth_call` **state overrides** (nothing
  is written during discovery), covering Solidity and Vyper layouts plus the
  OZ-v5 ERC-7201 namespace root; a single verified final write; per-token
  slot cache with verify-evict-rediscover on stale hits; optional
  `adjustTotalSupply` (underflow rejects, like forge); clear `Erc20DealError`
  for computed-balance tokens and non-anvil clients. Works on
  `ANVIL_FORK_URL` forks.
- `chain.deployContract({ abi, bytecode, args })` and `chain.deployErc20()`
  (committed, reproducibly-built `TestERC20` artifact — `contracts/` +
  `npm run build:contracts`, gated in CI like dist freshness).
- `chain.getErc20Balance`, `chain.setStorageAt`/`setCode`/`setNonce`
  passthroughs; new `@marigoldlabs/web3-tester/erc20` subpath with the
  transport-agnostic core (`dealErc20`, `discoverErc20BalanceSlot`,
  `getErc20Balance`, `TEST_ERC20_ABI`/`BYTECODE`).

### Added — multi-account & two-user fixtures (0.3.0)

- `walletOptions.accounts` / `walletOptions.accountIndexes` start a test
  connected with several anvil accounts; `wallet.switchAccount(address)`
  re-selects (most-recently-selected-first `accountsChanged`, no event when
  already selected, no reconnect while disconnected — unlike `setAccounts`,
  which still reconnects); `wallet.currentAccounts` exposes the ordered set.
- `createUser()` fixture factory: each call returns a `UserSession`
  (`context`, `page`, `wallet`, idempotent `close()`) — a fresh browser
  context on the shared worker chain(s), defaulting to anvil accounts
  1, 2, 3…, inheriting the test's `walletOptions` as a base layer under
  per-call overrides.
- Per-test snapshot/revert moved into a single shared `_chainIsolation`
  owner spanning every running chain — `createUser`-only tests now get
  isolation too, and a multi-user test takes exactly one snapshot.
- `PrivateKeyRpcClient` answers `eth_accounts` locally with its own address.

Behavior changes (0.3.0 migration):

- Wallet accounts are validated against the node's `eth_accounts` at
  `injectMockProvider()`/`setAccounts()` time — a non-anvil address now
  fails fast with remedies in the message instead of dying later in the
  dapp with anvil's opaque `-32602`. Impersonated accounts validate without
  a flag (the probe re-checks on miss); custom `RpcClient`s that cannot
  answer `eth_accounts` fail open, and
  `setAccounts(accounts, { allowUnknownAccounts: true })` is the explicit
  escape hatch.
- `eth_sendTransaction` with a `from` outside the wallet's accounts now
  throws `4100` instead of letting anvil sign with any unlocked account.

### Added — multi-chain mock routing (0.3.0)

- `MockWalletControllerOptions.chains`: register extra chains keyed by chain
  id, each backed by any `RpcClient` or an RPC URL string (new exported
  `httpRpcClient` adapter). Forwarded RPC (reads, sends, signing) routes to
  the **active chain's** backend; `wallet.addChain(chainId, backend)` and
  `wallet.backedChainIds` manage the registry test-side.
- `trustDappRpcUrls` (default false): opt-in to honoring dapp-supplied
  `rpcUrls[0]` in `wallet_addEthereumChain` after a bounded `eth_chainId`
  probe (EIP-3085 mismatch → `-32602`).
- Fixtures: `test.use({ extraChains: [{ chainId }] })` boots one extra Anvil
  per worker (port band `ANVIL_PORT+1000 + workerIndex*20 + index`,
  inheriting `anvilOptions`); new `chains` / `extraAnvils` worker fixtures;
  the `wallet` fixture snapshots/reverts **every** running chain per test.
- `SentTransactionRecord.chainId` records the chain a transaction executed on.
- Substrate for upcoming transports: `wallet.handleExternalRequest(request,
  { origin })` (same approval gating + origin scoping as the injected
  bridge) and `wallet.onProviderEvent(listener)`.

Behavior changes (0.3.0 migration):

- Forwarded calls after switching to a chain with no registered backend now
  throw `4901` (EIP-1193 "Chain Disconnected") instead of silently hitting
  the default node. To keep the old cosmetic behavior, alias the id
  explicitly: `chains: { '0xaa36a7': chain }`.
- `wallet_switchEthereumChain` validates before prompting: an unknown chain
  returns `4902` without consuming approval (deny-mode tests that expected
  `4001` for unknown chains must expect `4902`, matching real MetaMask).
- `wallet_addEthereumChain` now requires `rpcUrls` (non-empty array of valid
  URLs), like MetaMask and EIP-3085. wagmi always sends them.
- Chain ids canonicalize to lowercase minimal hex everywhere (`eth_chainId`,
  `chainChanged` payloads, `currentChainId`): `'0xAA36A7'` → `'0xaa36a7'`.
- Same-chain `wallet_switchEthereumChain`/`switchNetwork` no longer emit
  `chainChanged` (MetaMask emits only on change).

### Packaging

- The package is now explicitly private (`"private": true`): it stays
  UNLICENSED and is consumed from git (committed `dist/`), resolving the
  prior `UNLICENSED` + `private: false` contradiction.

### Security

- **Live wallets are now deny-by-default** (breaking): `createLiveFixtures`
  builds the wallet with `autoApprove: false`, so signing, sending
  (`eth_sendRawTransaction` included), and wallet prompts throw `4001` until
  the test arms them — per request via the new
  `wallet.approveNext(methods?, match?)` (the optional `match` predicate
  binds the grant to an expected payload so another page script cannot race
  it), or per test via `wallet.autoApprove(true)` /
  `test.use({ liveOptions: { walletOptions: { autoApprove: true } } })`.
  Page scripts (including third-party includes on the dapp under test) can
  no longer spend or sign with the live key unprompted. The wallet still
  starts pre-connected (`eth_accounts` answers), and `eth_requestAccounts`
  requires arming even then.
- **Origin scoping**: `MockWalletControllerOptions.allowedOrigins` (http(s)
  origins only) restricts the wallet to frames on the listed origins: the
  provider is not even installed elsewhere, and the RPC bridge — now an
  `exposeBinding` that sees the calling frame — refuses out-of-scope frames
  with `4100`. Same-origin `about:blank`/`srcdoc` children inherit their
  parent's origin, like a real extension. When Playwright's `baseURL` is
  configured, live fixtures default `allowedOrigins` to it, so embedded
  third-party iframes never reach the wallet; without a `baseURL` every
  frame is served unless `allowedOrigins` is set explicitly.
- **`PrivateKeyRpcClient` chain guard** (breaking for non-testnet chains):
  construction refuses chains that are neither `testnet: true` nor local dev
  chains (31337/1337) unless `allowMainnet: true` is passed
  (`createLiveFixtures({ allowMainnet })` passes it through), and the first
  broadcast (`eth_sendTransaction` / `eth_sendRawTransaction`) verifies the
  RPC endpoint's `eth_chainId` against the configured chain first.
- **Anvil loopback enforcement** (breaking for non-loopback hosts):
  `AnvilInstance.start()` refuses a non-loopback `host` (e.g.
  `ANVIL_HOST=0.0.0.0`) — or a `--host` smuggled through `extraArgs` —
  unless `allowNonLoopbackHost: true` / `ANVIL_ALLOW_NON_LOOPBACK=true` is
  set. Anvil's admin RPC (impersonation, `setBalance`, fork URL + API key)
  is unauthenticated.

### Added / Changed

- **Current MetaMask (13.x "multichain" UI) is now fully supported** and is the
  default (`DEFAULT_METAMASK_VERSION` = 13.34.1). The opt-in smoke suite runs
  the full journey — onboarding, add/switch network, connect, sign, send,
  reject — against the real extension on both 13.x and the older 12.x UI.
- Onboarding completion on 13.x: handle the side-panel completion screen (the
  "Open wallet" button opens Chrome's side panel instead of navigating) and
  13.x's debounced IndexedDB persistence (dwell on a working home screen so the
  vault/`completedOnboarding` flush before teardown).
- `getAccountAddress`, `addNetwork`, and `switchNetwork` span both UI
  generations: 13.x account address via the multichain account address menu →
  Addresses → `multichain-address-row-copy-button` (read off the clipboard);
  custom networks via the network picker's "Custom" tab; network switching by
  CAIP-2 chain id (`switchNetwork(name, { chainId })`).
- Note: on 13.x a single SRP import derives several accounts into a multichain
  account tree with no single pre-connect "selected" account; prefer
  `expectedAddress` or the dapp-reported connected account.

## 0.2.0 — 2026-06-09

Hardening release driven by a full library review (see
`reports/web3-tester-library-review-2026-06-09.md`).

### Fixed

- **Committed dist was broken for git consumers**: `dist/real-wallet-setup.js`
  was missing because `.gitignore` ignored `dist/` while it was force-tracked.
  `dist/` is no longer gitignored and CI now fails if a fresh build differs
  from the committed output.
- **`personal_sign`/`eth_sign` corrupted non-UTF-8 payloads**: hex messages
  are now always signed as raw bytes (viem's `hexToString` substitutes U+FFFD
  instead of throwing, so binary messages were lossily decoded before
  signing). Byte-identical for UTF-8 text.
- **Anvil readiness race**: `AnvilInstance.start()` previously HTTP-probed the
  port and could silently adopt a pre-existing node — even one on the wrong
  chain. Readiness is now gated on the spawned process listening plus an
  `eth_chainId` check, and port conflicts fail loudly.
- `personal_sign` accepts both `[message, address]` and legacy
  `[address, message]` param orders.
- Injected provider sync mirrors (`chainId`, `selectedAddress`,
  `networkVersion`) refresh after navigation instead of resetting to the
  injection-time snapshot.
- Real-wallet `connectToDapp(accounts)` and `approveTokenPermission`'s
  `spendLimit` now fail loudly instead of silently no-oping when the MetaMask
  UI does not match; `confirmTransaction` settles on UI state instead of a
  fixed 1s wait; `headless` uses `--headless=new` so extensions actually load.

### Added

- **Real-wallet trifecta** (validated by an opt-in smoke suite against the
  pinned MetaMask build):
  - `prepareMetaMaskExtension()` — pinned MetaMask download with caching
    (`DEFAULT_METAMASK_VERSION` 12.23.1, `WEB3_TESTER_METAMASK_VERSION`
    override, optional sha256).
  - `buildWalletProfile()` / `cloneWalletProfile()` — one-time onboarding into
    a cache keyed by (seed, password, extension version), verified against
    the seed-derived address, with disposable per-test clones (parallel-safe).
  - `@marigoldlabs/web3-tester/real-wallet-fixtures` — Playwright fixture
    family (`realWallet`, `realWalletOptions`) with `context`/`page` rebound
    to the persistent extension context.
  - Wallet-side network management: `addNetwork`, `switchNetwork`,
    `approveNewNetwork`, `rejectNewNetwork`, `approveSwitchNetwork`,
    `rejectSwitchNetwork` — MetaMask can be pointed at the library's own
    Anvil node programmatically.
  - MetaMask 12.23 onboarding support (Get started interstitial, Terms of Use
    dialog) and confirmation handling that opens `notification.html` on
    demand (MetaMask suppresses its popup when extension tabs are open).
- **Mock wallet**: `holdNextRequest()` (pending-approval simulation),
  `waitForNextTransaction()`, `sentTransactions`/`sentTransactionRequests`
  recording, `isConnected()`, 4902/known-chain semantics for
  `wallet_switchEthereumChain` + `wallet_addEthereumChain`,
  `wallet_revokePermissions`, 4100 on signing while disconnected,
  approval gating for `wallet_*` prompt methods, `restrictReturnedAccounts`
  permission caveats, distinct frozen EIP-6963 provider objects per wallet,
  context-level injection (popups get the provider), 4200 for unknown
  `wallet_*` methods.
- `createLiveFixtures({ chain, privateKeyEnv, rpcUrlEnv, walletOptions })` —
  live fixtures are no longer hardcoded to Fjord env names
  (`WEB3_TESTER_PRIVATE_KEY` with `FJORD_PRIVATE_KEY` legacy alias).
- `AnvilOptions.forkBlockNumber` and `AnvilOptions.extraArgs`.
- CI workflow (typecheck, build, dist-freshness gate, hermetic library tests)
  and a `library` vs `fjord` Playwright project split — `npm test` is
  hermetic; the Fjord QA suite is `npm run test:fjord`.
- Hermetic test coverage: 46 specs across anvil lifecycle, chain helpers,
  offline signing, provider compliance, and controller behavior.

### Changed

- Fixture Anvil port base default moved from 8545 to 8645 to avoid colliding
  with developer-run dev nodes (`ANVIL_PORT` overrides).
- `eth_signTypedData_v3` signs via the backend's v4 path; legacy v1 returns a
  clear `4200` in both mock and live modes.
- Exported `RpcClient`, `HeldRequest`, `SentTransactionRecord` types; added
  `engines` (node >= 20) and the `./package.json` export.
- Playwright traces for live Fjord runs are opt-in (`FJORD_TRACE=true`)
  because they capture the authenticated wallet session.

## 0.1.2

Initial harness: mock provider + per-worker Anvil fixtures, live Sepolia
fixtures, imperative MetaMask adapter, Fjord v4 QA suite.
