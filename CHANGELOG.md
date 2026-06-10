# Changelog

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
