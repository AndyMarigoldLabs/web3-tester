# Web3 Tester

`@marigoldlabs/web3-tester` is a Playwright, Anvil, Viem, and wallet harness for Web3 end-to-end tests.

The injected fixtures test dApp behavior with a programmable EIP-1193 provider. The real-wallet adapter launches a persistent Chromium profile with MetaMask, imports or unlocks the profile when configured, and exposes wallet-side actions so consumer apps do not carry extension automation code. A lower-level extension launcher covers other unpacked Chromium wallets so wallet-specific adapters can share the same profile, headless, extension-ID, and page-opening behavior.

## What It Provides

- Playwright fixtures that start one Anvil node per worker for parallel-safe local EVM tests.
- Browser-project portable injected and live fixtures for Chromium, Firefox, and WebKit; real extension fixtures stay Chromium-only because Chrome extensions require Chromium.
- Automatic `evm_snapshot` and `evm_revert` around every wallet test.
- A programmable `MockWalletController` for approval, rejection, pending-approval holds, hardware-wallet confirmation states, disconnects, account changes, and network-change events, with transaction/token-watch recording (`sentTransactions`, `waitForNextTransaction`, `watchedAssets`, `waitForNextWatchedAsset`).
- EIP-6963 provider announcements, frozen `provider.info` identity metadata, and legacy `window.ethereum.providers` arrays (one distinct provider object per wallet) for wallet selector testing.
- Coinbase/Base Account simulation for `wallet_connect`, sub-account RPCs, and spend-permission lookup/fetch flows, auto-enabled by the Coinbase persona.
- Viem-backed chain helpers for impersonation, balance setup, time travel, and block mining.
- Optional live-chain fixtures for controlled testnet QA with a runtime-only private key (`createLiveFixtures` for custom chains/env names).
- Optional WalletConnect/AppKit simulation (`@marigoldlabs/web3-tester/walletconnect`): a headless WC v2 wallet peer that pairs with the dapp's QR modal, handles One-Click Auth/SIWE `session_authenticate`, and answers EVM plus Solana namespace requests through the same wallet gating — needs the optional `@walletconnect/*` peers and a Reown project id.
- Built-in wallet personas for major wallet selector coverage (MetaMask, Rabby, Coinbase Wallet, Phantom EVM, Rainbow, OKX, Trust, Brave, Zerion, Backpack, Solflare, Ledger, Trezor, Safe, Bitget, TokenPocket, SafePal, Binance Wallet, imToken, MathWallet, Frame, Enkrypt, Core, Frontier, OneKey, CTRL, Uniswap Wallet, Argent, Exodus, and Fireblocks): EIP-6963 metadata, provider flags, known globals, legacy provider arrays, Phantom/Backpack/SafePal/Solflare Solana discovery surfaces, and WalletConnect metadata.
- Real MetaMask mode: pinned-version extension download (`prepareMetaMaskExtension`), one-time onboarding into a cached profile with disposable per-test clones (`buildWalletProfile`/`cloneWalletProfile`), Playwright fixtures (`@marigoldlabs/web3-tester/real-wallet-fixtures`), wallet-side network add/switch, dapp connection, signature/transaction confirmation and rejection, and token approval helpers — validated end to end by an opt-in smoke suite against the pinned MetaMask build.
- Generic Chromium wallet extension launcher (`@marigoldlabs/web3-tester/real-wallet-extension`) for Rabby, Coinbase Wallet, Phantom, OKX, Trust, Brave, and other unpacked Chrome extensions: persistent profile launch, explicit headed/headless handling, extension-ID discovery, manifest helpers, default popup/options page resolution, and extension page openers. Wallet-specific UI automation layers can build on this without reimplementing browser setup.

## Install In A Consumer App

Install as a dev dependency:

```bash
npm install --save-dev @marigoldlabs/web3-tester
```

Then import the local deterministic fixture:

```ts
import { expect, test } from '@marigoldlabs/web3-tester/fixtures';

test('user can submit a wallet transaction', async ({ page, wallet }) => {
  await page.goto('/swap');

  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.getByText('Mock Wallet').click();

  await page.getByRole('button', { name: /swap/i }).click();
  await expect(page.getByText(/success/i)).toBeVisible();

  expect(wallet.primaryAccount).toMatch(/^0x/);
});
```

> Note: fixtures are lazy. The provider is only injected when a test
> references the `wallet` fixture — a test that destructures only `page`
> will have no `window.ethereum`.

Run injected/mock-wallet and live-key tests across Playwright's browser
projects with the normal project matrix:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
  use: {
    baseURL: process.env.DAPP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

Keep `@marigoldlabs/web3-tester/real-wallet-fixtures` and
`/real-wallet-extension-fixtures` in a dedicated Chromium project. Those
fixtures launch a persistent Chromium extension context and fail fast when a
Firefox or WebKit project tries to use them.

Testing pending-approval UI and rejection paths:

```ts
test('shows a pending state until the user confirms', async ({ page, wallet }) => {
  const held = wallet.holdNextRequest('eth_sendTransaction');
  await page.getByRole('button', { name: /swap/i }).click();
  await expect(page.getByText(/confirm in your wallet/i)).toBeVisible();

  (await held).approve();
  await expect(page.getByText(/success/i)).toBeVisible();
});
```

For live testnet tests, import the live fixture (Sepolia by default; use
`createLiveFixtures({ chain })` for other chains):

```ts
import { expect, test } from '@marigoldlabs/web3-tester/live-fixtures';

test('signs in through SIWE on Sepolia', async ({ page, wallet }) => {
  await page.goto('/');

  // Live wallets are deny-by-default: arm each prompt before triggering it.
  wallet.approveNext('eth_requestAccounts');
  await page.getByRole('button', { name: /connect/i }).click();

  wallet.approveNext('personal_sign');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByText(wallet.primaryAccount.slice(0, 6))).toBeVisible();
});
```

To deliberately auto-approve a whole test instead, use
`test.use({ liveOptions: { walletOptions: { autoApprove: true } } })`.

For fully in-UI real wallet tests, use the real-wallet fixtures. The pinned
MetaMask build is downloaded automatically, onboarding runs once into a
cached profile, and every test gets a disposable clone of that profile:

```ts
import { expect, test } from '@marigoldlabs/web3-tester/real-wallet-fixtures';

test.use({
  realWalletOptions: {
    setup: { seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE },
    baseURL: 'https://app.example.com',
    // Required: pick headed or headless explicitly (or set
    // WEB3_TESTER_REAL_WALLET_HEADLESS). Headed is the fully validated mode.
    headless: false,
  },
});

test('confirms a real MetaMask transaction', async ({ page, realWallet }) => {
  await realWallet.addNetwork({
    name: 'Anvil Local',
    rpcUrl: 'http://127.0.0.1:8645',
    chainId: 31337,
    symbol: 'ETH',
  });
  await realWallet.switchNetwork('Anvil Local');

  await page.goto('/');
  await page.getByRole('button', { name: /connect/i }).click();
  await realWallet.connectToDapp();

  await page.getByRole('button', { name: /swap/i }).click();
  await realWallet.confirmTransaction();
});
```

The imperative API remains available for custom setups (preconfigured
profiles, attaching to a real Chrome profile):

```ts
import { launchRealWallet } from '@marigoldlabs/web3-tester/real-wallet';
import { prepareMetaMaskExtension } from '@marigoldlabs/web3-tester/metamask-extension';

const wallet = await launchRealWallet({
  extensionPath: await prepareMetaMaskExtension(),
  profileDir: process.env.WEB3_TESTER_REAL_WALLET_PROFILE_DIR as string,
  setup: { seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE },
  headless: false,
});

await wallet.connectToDapp();
await wallet.confirmSignature();
await wallet.confirmTransaction();
await wallet.close();
```

For real extension coverage beyond MetaMask, use the generic launcher and
drive wallet-specific UI with Playwright locators:

```ts
import { launchRealWalletExtension } from '@marigoldlabs/web3-tester/real-wallet-extension';

const rabby = await launchRealWalletExtension({
  extensionPath: process.env.RABBY_EXTENSION_PATH as string,
  extensionName: 'Rabby Wallet',
  profileDir: process.env.RABBY_PROFILE_DIR as string,
  headless: false,
});

const popup = rabby.page ?? await rabby.openPage('popup.html');
await popup.getByRole('button', { name: /unlock/i }).click();
await rabby.close();
```

When onboarding is expensive, cache a prepared non-MetaMask profile with the
same clone model the MetaMask fixture uses:

```ts
import {
  buildWalletExtensionProfile,
  cloneWalletProfile,
} from '@marigoldlabs/web3-tester/real-wallet-cache';

const cached = await buildWalletExtensionProfile({
  cacheKey: 'rabby-anvil-seed-v1',
  extensionPath: process.env.RABBY_EXTENSION_PATH as string,
  extensionName: 'Rabby Wallet',
  headless: false,
  setup: {
    run: async (session) => {
      const popup = session.page ?? await session.openPage('popup.html');
      // Drive Rabby onboarding/unlock/import with Playwright locators here.
      await popup.getByRole('button', { name: /unlock/i }).click();
    },
  },
});

const profileDir = await cloneWalletProfile(cached, '/tmp/rabby-test-profile');
```

For Playwright suites, the generic fixture wraps that cache/clone/teardown
flow and exposes the persistent extension context as `context` / `page`:

```ts
import {
  expect,
  test,
} from '@marigoldlabs/web3-tester/real-wallet-extension-fixtures';

test.use({
  realWalletExtensionOptions: {
    extensionPath: process.env.RABBY_EXTENSION_PATH,
    extensionName: 'Rabby Wallet',
    profileCacheKey: 'rabby-anvil-seed-v1',
    headless: false,
    profileSetup: {
      run: async (session) => {
        const popup = session.page ?? await session.openPage('popup.html');
        await popup.getByRole('button', { name: /unlock/i }).click();
      },
    },
  },
});

test('opens with a prepared wallet profile', async ({ page, realWalletExtension }) => {
  await page.goto('https://app.example.test');
  expect(realWalletExtension.extensionId).toMatch(/^[a-p]{32}$/);
});
```

MetaMask version pinning: selectors are maintained against
`DEFAULT_METAMASK_VERSION` (currently 13.34.1, current MetaMask) and validated
by the opt-in smoke suite (`npm run smoke:real-wallet`), which runs the full
journey — onboarding, add/switch network, connect, sign, send, reject — plus
the account/token/settings surface against the real extension. The UI
generation (13.x "multichain" vs the older 12.x) is an explicit configuration,
derived from the extension manifest at launch and overridable via the
`generation` option: only the configured generation's selectors are driven —
the other generation is never probed as a fallback. Set
`WEB3_TESTER_METAMASK_VERSION` to pin a specific build (e.g. `12.23.1`; 12.x
is supported on a best-effort validation cadence — 13.x gates releases). Bump
the pin deliberately and re-run the smoke suite, since MetaMask UI selectors
can drift between releases.

## Local Development

```bash
npm install
npx playwright install chromium firefox webkit
npm run typecheck
npm run typecheck:examples
npm run build
npm test          # hermetic library tests (needs anvil)
npm run test:browsers # focused Chromium/Firefox/WebKit fixture matrix
npm run smoke:real-wallet  # opt-in real-MetaMask smoke suite (headed)
```

Foundry's `anvil` executable must be available on `PATH`, or set `ANVIL_EXECUTABLE`.

This repo also auto-detects local Foundry binaries at:

- `tools/foundry/anvil`
- `tools/foundry/anvil.exe`

## Docker Anvil Runtime

If Docker Desktop is running, Anvil can be launched in a per-worker Foundry container:

```bash
ANVIL_RUNTIME=docker npm test
```

PowerShell:

```powershell
$env:ANVIL_RUNTIME = 'docker'
npm test
```

Each Playwright worker maps a unique host port to the container's Anvil RPC port, so tests remain parallel-safe.

## Environment Variables

Copy `.env.example` for local reference. Do not commit real private keys.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANVIL_EXECUTABLE` | `anvil` | Path to the Anvil binary. |
| `ANVIL_RUNTIME` | `binary` | Set to `docker` to run Anvil through Docker Desktop. |
| `ANVIL_DOCKER_IMAGE` | `ghcr.io/foundry-rs/foundry:latest` | Docker image used when `ANVIL_RUNTIME=docker`. |
| `ANVIL_HOST` | `127.0.0.1` | Host for worker Anvil RPC endpoints. Non-loopback hosts are refused unless `ANVIL_ALLOW_NON_LOOPBACK=true`. |
| `ANVIL_ALLOW_NON_LOOPBACK` | `false` | Explicit opt-in to bind Anvil beyond loopback (exposes its unauthenticated admin RPC to the network). |
| `ANVIL_PORT` | `8645` | Base port (worker index is added for isolation). Defaults off 8545 so a developer-run dev node never collides. |
| `ANVIL_CHAIN_ID` | `31337` | Chain ID exposed by local Anvil and the injected provider. |
| `ANVIL_FORK_URL` | unset | Optional fork RPC URL. |
| `ANVIL_SILENT` | `true` | Set to `false` to stream Anvil logs. |
| `WEB3_TESTER_PRIVATE_KEY` | unset | Runtime-only private key for live-chain fixtures. |
| `WEB3_TESTER_RPC_URL` | Viem default | Optional RPC URL for live fixtures (`SEPOLIA_RPC_URL` legacy alias). |
| `WEB3_TESTER_METAMASK_VERSION` | pinned default | MetaMask release downloaded by `prepareMetaMaskExtension`. |
| `WEB3_TESTER_REAL_WALLET_EXTENSION_PATH` | auto-download | Path to an unpacked MetaMask extension (skips the download). |
| `WEB3_TESTER_REAL_WALLET_PROFILE_DIR` | profile cache | Explicit persistent Chromium user-data directory, or a Chrome profile directory such as `Profile 1`. Disables the per-test profile cache. |
| `WEB3_TESTER_REAL_WALLET_PASSWORD` | deterministic test password | MetaMask password used to unlock profiles. |
| `WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE` | unset | Seed phrase used to build the cached real-wallet profile. |
| `WEB3_TESTER_REAL_WALLET_HEADLESS` | none — explicit choice required | `true`/`false`. Real-wallet launches refuse to guess: pick headed (fully validated) or headless (needs the full Chromium from `npx playwright install chromium`) here or via the `headless` option. |
| `WEB3_TESTER_REAL_WALLET_SMOKE` | unset | Set `true` to run the real-MetaMask smoke suite (`npm run smoke:real-wallet`). |
| `WEB3_TESTER_WC_PROJECT_ID` | unset | Reown project id; set to run the opt-in WalletConnect relay suite. |
| `WEB3_TESTER_BENCHMARK` | unset | Set `true`/`1` to record opt-in benchmark spans for slow/flaky test runs. |
| `WEB3_TESTER_BENCHMARK_OUTPUT` | `reports/web3-tester-benchmark.ndjson` | NDJSON file where benchmark spans are appended as they finish. |
| `WEB3_TESTER_BENCHMARK_VERBOSE` | unset | Set `true` to also stream benchmark spans to stderr. |

### Benchmarking slow or flaky runs

Benchmarking is disabled by default and is diagnostic-only: it records timings
without changing test behavior. When enabled, Playwright tests attach a
`web3-tester-benchmark.json` artifact per test and append every span to the
NDJSON report path.

```bash
npm run smoke:real-wallet -- --benchmark
npm run smoke:real-wallet -- --benchmark --benchmark-output=reports/real-wallet-benchmark.ndjson
WEB3_TESTER_BENCHMARK=true WEB3_TESTER_WC_PROJECT_ID=<id> npm test -- walletconnect-live
```

The real-wallet fixtures record extension/profile setup, launch, close, and
every wallet-side session method. The live WalletConnect relay test records
pairing, request, push-event, disconnect, and close phases.

## Package Surface

The installable package exports:

- `@marigoldlabs/web3-tester`
- `@marigoldlabs/web3-tester/fixtures`
- `@marigoldlabs/web3-tester/live-fixtures`
- `@marigoldlabs/web3-tester/real-wallet`
- `@marigoldlabs/web3-tester/real-wallet-extension`
- `@marigoldlabs/web3-tester/real-wallet-extension-fixtures`
- `@marigoldlabs/web3-tester/real-wallet-cache`
- `@marigoldlabs/web3-tester/real-wallet-fixtures`
- `@marigoldlabs/web3-tester/metamask-extension`
- `@marigoldlabs/web3-tester/wallet-personas`
- `@marigoldlabs/web3-tester/safe`
- `@marigoldlabs/web3-tester/benchmark`
- `@marigoldlabs/web3-tester/anvil`
- `@marigoldlabs/web3-tester/mock-wallet-controller`
- `@marigoldlabs/web3-tester/private-key-rpc-client`

Full API notes are in [docs/API.md](docs/API.md).

## Chain Control

```ts
await chain.impersonateAccount('0x0000000000000000000000000000000000000001');
await chain.setBalance(wallet.primaryAccount, 10_000n * 10n ** 18n);
await chain.fastForward(7 * 24 * 60 * 60);
await chain.mine(3);

// Token seeding and deployment (forge-style cheatcodes):
const token = await chain.deployErc20({ symbol: 'USDX', decimals: 6 });
await chain.dealErc20(token.address, wallet.primaryAccount, 5_000_000_000n);
// dealErc20 also works on ANVIL_FORK_URL forks against real mainnet tokens.
```

## Wallet Control

```ts
await wallet.simulateRejection('eth_sendTransaction');
await wallet.lock();   // hides accounts; _metamask.isUnlocked() -> false
await wallet.unlock(); // restores accounts for connected wallets
await wallet.disconnect();
await wallet.reconnect();
// Accounts are validated against the node's signers — use chain.accounts()
// entries (or chain.impersonateAccount(addr) first for send-only flows).
const [, second] = await chain.accounts();
await wallet.setAccounts([second]);
await wallet.switchAccount(second); // reorders + emits accountsChanged
await wallet.switchNetwork(11155111);

// Pending-approval simulation and transaction assertions:
const held = wallet.holdNextRequest('personal_sign');
// ... trigger the dapp action, assert the pending UI ...
(await held).reject('User changed their mind.');

// Ledger/Trezor-style confirmation simulation:
wallet.configureHardwareWallet({
  approvalDelayMs: 750,
  requiredApps: { solana_signMessage: 'Solana' },
});
wallet.setHardwareWalletState('wrong-app'); // locked | wrong-app | blind-signing-disabled | disconnected | ready

const txPromise = wallet.waitForNextTransaction();
// ... trigger the dapp action ...
const hash = await txPromise;

const assetPromise = wallet.waitForNextWatchedAsset();
// ... trigger wallet_watchAsset ...
const watched = await assetPromise;
```

Dapp-initiated `wallet_switchEthereumChain` follows MetaMask semantics: it
throws 4902 for chains the wallet does not know; chains become known via
`wallet_addEthereumChain` or a test-driven `wallet.switchNetwork(...)`.

Multi-account and multi-user testing:

```ts
// Start connected with three anvil accounts:
test.use({ walletOptions: { accountIndexes: [0, 1, 2] } });

// Two users, one chain — seller lists, buyer purchases:
test('buyer sees the listing', async ({ page, wallet, createUser }) => {
  const buyer = await createUser(); // own context + page, anvil account #1
  await buyer.page.goto('/listings/1');
  await buyer.page.getByRole('button', { name: 'Buy' }).click();
});
```

## Multiple Wallet Selectors

```ts
import { walletPersonas, walletProfiles } from '@marigoldlabs/web3-tester/wallet-personas';

test.use({
  walletOptions: {
    persona: walletPersonas.metamask(),
    additionalPersonas: [
      walletPersonas.rabby(),
      walletPersonas.coinbase(),
      walletPersonas.phantomEvm(),
      walletPersonas.solflare(),
      walletPersonas.bitget(),
      walletPersonas.tokenPocket(),
      walletPersonas.safePal(),
      walletPersonas.binance(),
      walletPersonas.safe(),
    ],
  },
});
```

Personas are still backed by the same deterministic controller: approvals,
rejections, holds, chain switching, and transaction recording work exactly as
they do for the default mock wallet. Legacy `providerInfo` and
`additionalProviders` remain supported for metadata-only cases.
Injected EVM providers include the common EventEmitter aliases used by wallet
SDKs (`addListener`, `off`, `listeners`, `listenerCount`) and emit an initial
`connect` event for already-connected wallets after page scripts can attach
listeners. Legacy callback batch calls return JSON-RPC response arrays with
per-payload `result` or `error` entries. Subscription streams are deliberately out of scope:
`eth_subscribe` and `eth_unsubscribe` return a wallet-shaped `4200`; use a
direct viem/WebSocket client when a test needs live chain subscriptions.
The Phantom, Backpack, SafePal, and Solflare personas also expose lightweight Solana
browser providers (`window.phantom.solana`, `window.solana`,
`window.backpack.solana`, `window.safepal`, `window.solflare`) and register
Wallet Standard wallets for wallet-adapter discovery. Solflare is modeled as
Solana-only (`evm: false`), so it does not add a `window.ethereum` provider or
an EIP-6963 announcement. These Solana surfaces are for selector, connect, and
sign-in/signing UI tests; they expose deterministic `signIn` and
`solana:signIn` results, trusted/silent reconnect behavior, the same
controller approval/hardware gates as EVM requests, and the same EventEmitter
aliases. `request({ method: 'getAccounts' | 'requestAccounts' })` returns
base58 public-key strings, while `solana_getAccounts` / `solana_requestAccounts`
return objects with `publicKey`, `pubkey`, and `address` fields for
WalletConnect-style probes. Controller lock/disconnect events hide direct Solana provider
accounts too (`publicKey: null`, Wallet Standard `accounts: []`), and unlock
restores providers that were connected before the lock. These surfaces do not
start a Solana validator or submit real Solana
transactions.
WalletConnect personas include peer metadata plus verified launch templates
for common mobile handoff tests via `formatWalletConnectUriForPersona`.
WalletConnect EVM namespaces advertise EIP-5792 batch methods by default, so
AppKit/wagmi `sendCalls` traffic reaches the same controller implementation
as injected `wallet_sendCalls`. EVM `accountsChanged` events also refresh the
session namespace's CAIP account list when accounts are visible; lock and
disconnect still emit `[]` without rewriting the approved namespace. Solana
WalletConnect namespaces receive `accountsChanged` events with Solana public
keys or `[]` as the controller locks, unlocks, or disconnects. One-Click
Auth/SIWE `session_authenticate`
requests produce CAIP-122 Cacao signatures through the same
`eth_requestAccounts` and `personal_sign` gates; pass
`sessionAuthenticate: false` to keep sign-client's fallback behavior.

Use wallet profiles when identity should also imply behavior:

```ts
test.use({
  walletOptions: walletProfiles.ledger({
    hardwareWallet: { deviceState: 'wrong-app', approvalDelayMs: 0 },
  }),
});
```

For Coinbase/Base Account flows, the Coinbase persona enables wallet-specific
RPC methods and lets tests seed spend permissions and sub-accounts:

```ts
test.use({
  walletOptions: walletProfiles.coinbase({
    coinbase: {
      permissions: [{
        createdAt: 1_700_000_000,
        permissionHash: `0x${'11'.repeat(32)}`,
        signature: `0x${'aa'.repeat(65)}`,
        spendPermission: {
          account: '0x0000000000000000000000000000000000000001',
          spender: '0x0000000000000000000000000000000000000002',
          token: '0x0000000000000000000000000000000000000003',
          allowance: '1000000000000000000',
          period: 86_400,
          start: 1_700_000_000,
          end: 4_102_444_800,
          salt: '1',
          extraData: '0x',
        },
      }],
      subAccounts: [{
        address: '0x0000000000000000000000000000000000000004',
        account: '0x0000000000000000000000000000000000000001',
        domain: 'https://app.example.com',
      }],
    },
  }),
});
```

`wallet_connect` supports Coinbase's `signInWithEthereum` capability,
`wallet_addSubAccount` stores generated or deployed sub-accounts for
`wallet_getSubAccounts`, and `coinbase_fetchPermissions` /
`coinbase_fetchPermission` return seeded spend-permission data. The Coinbase
WalletConnect persona advertises these methods in the EVM namespace by default.

## Safe Transaction Service

```ts
import {
  SafeTransactionServiceClient,
  SafeWalletHarness,
  hashSafeTransactionTypedData,
} from '@marigoldlabs/web3-tester/safe';

const transactionService = new SafeTransactionServiceClient({
  // Include the service API prefix used by your deployment.
  baseUrl: 'https://safe-transaction-sepolia.safe.global/api/v1',
  chainId: 11155111,
});

const safe = new SafeWalletHarness({
  safeAddress: '0x...',
  owners: [owner1, owner2],
  threshold: 2,
  chainId: 11155111,
  transactionService,
});
```

The Safe module treats Transaction Service support as required surface: the
REST client covers propose, confirm, fetch, list, and confirmation listing
against Safe Transaction Service deployments. `InMemorySafeTransactionService`
exists for hermetic tests and local workflow assertions only.

`SafeWalletHarness` uses protocol-compatible Safe EIP-712 transaction hashes by
default, and `SafeTransactionServiceClient` does the same when `chainId` is
configured. Use `hashSafeTransactionTypedData(safeAddress, chainId, tx)` when
you need to precompute or assert the `safeTxHash` yourself;
`hashSafeTransactionData` remains available as a deterministic fixture hash via
`safeTxHashStrategy: 'fixture'`.

For Safe Apps SDK iframe flows, install the parent bridge before loading the
app iframe:

```ts
import { injectSafeAppBridge } from '@marigoldlabs/web3-tester/safe';

await page.setContent('<iframe id="safe-app"></iframe>');
await injectSafeAppBridge(page, safe);
await page.locator('#safe-app').evaluate((iframe, srcdoc) => {
  (iframe as HTMLIFrameElement).srcdoc = srcdoc;
}, appHtml);
```

The bridge answers Safe Apps SDK v1 `postMessage` requests such as
`getSafeInfo`, `getChainInfo`, `sendTransactions`, `getTxBySafeTxHash`,
`rpcCall`, signing requests, permissions, balances, and address book lookups.
`getSafeInfo` returns the extended SDK fields (`nonce`, `implementation`,
`modules`, `fallbackHandler`, `guard`, `version`), `getChainInfo` uses the Safe
Gateway `blockExplorerUriTemplate.txHash` key, and `getSafeBalances` returns
the SDK `{ fiatTotal, items }` response shape. When `allowedOrigins` is set,
the bridge rejects untrusted and missing/null iframe origins. Multi-call
`sendTransactions` requests are encoded as a delegatecall to Safe
MultiSendCallOnly; pass `multiSendAddress` for custom deployments.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/` | Reusable package source. |
| `tests/` (library project) | Hermetic harness self-tests: `anvil`, `live-fixtures`, `mock-wallet`, `private-key-rpc-client`, `provider-injection`, `real-wallet`, `real-wallet-smoke` (opt-in). |
| `docs/` | API, architecture, and roadmap documentation. |
| `examples/` | Copyable consumer-app snippets. |

## Safety Model

- Local tests use deterministic Anvil accounts only, and Anvil refuses to
  bind beyond loopback unless `ANVIL_ALLOW_NON_LOOPBACK=true` is set — its
  admin RPC (impersonation, `setBalance`, the fork URL) is unauthenticated.
- Live tests require explicit environment variables and never store private keys in source.
- Live wallets are deny-by-default: signing, sending (including
  `eth_sendRawTransaction`), and wallet prompts (`eth_requestAccounts`
  included, even though the wallet starts pre-connected) throw `4001` until
  the test arms them — `wallet.approveNext(methods?, match?)` per request, or
  `wallet.autoApprove(true)` /
  `test.use({ liveOptions: { walletOptions: { autoApprove: true } } })` as a
  deliberate whole-test opt-in. So page scripts — including third-party
  includes on the dapp under test — cannot spend or sign unprompted.
- When Playwright's `baseURL` is configured, the live provider is
  origin-scoped to it: out-of-scope frames get no `window.ethereum` at all
  and the RPC bridge refuses them with `4100`. Override with
  `allowedOrigins`; without a `baseURL`, every frame is served.
- `PrivateKeyRpcClient` refuses chains that are not testnets or local dev
  chains unless constructed with `allowMainnet: true`, and verifies the RPC
  endpoint's `eth_chainId` matches the configured chain before the first
  broadcast (`eth_sendTransaction` / `eth_sendRawTransaction`). It only signs
  transactions from its own account and preserves typed transaction fields
  such as `type`, `accessList`, blob fee/hash fields, and `authorizationList`.
- Real-wallet tests use a persistent browser profile and keep extension-side automation inside this package.
- Mutation tests are skipped unless their opt-in flag is set.
- Published reports redact secrets and record transaction hashes only when useful for auditability.

## More Documentation

- [docs/API.md](docs/API.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
