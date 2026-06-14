# API Reference

This package exposes three Playwright fixture families and a real-wallet adapter:

- `fixtures`: local deterministic Anvil tests.
- `live-fixtures`: live testnet tests that sign with a runtime-only private key.
- `real-wallet-fixtures`: real-MetaMask tests with automatic extension download and per-test cached profiles.
- `real-wallet`: the imperative MetaMask adapter underneath the fixtures.
- `real-wallet-extension`: generic Chromium extension launcher for non-MetaMask real-wallet adapters and custom Playwright control.
- `real-wallet-extension-fixtures`: Playwright fixtures around generic Chromium extension sessions and cached profile clones.
- `real-wallet-cache`: shared cached-profile builders and clone helper for MetaMask and generic Chromium wallet extensions.
- `metamask-extension`: pinned MetaMask download/cache helpers.
- `wallet-personas`: built-in major-wallet identities for injected and WalletConnect tests.
- `safe`: Safe Transaction Service client and local Safe workflow harness.

Fixtures are lazy: the mock provider is only injected when a test references the `wallet` fixture.

## Local Fixtures

```ts
import { expect, test } from '@marigoldlabs/web3-tester/fixtures';
```

Fixtures:

| Fixture | Scope | Description |
| --- | --- | --- |
| `wallet` | test | `MockWalletController` injected into the page before app scripts run. |
| `createUser` | test | Factory for additional users: each call returns a `UserSession` (`{ context, page, wallet, close() }`) — a fresh browser context with its own wallet on the shared worker chain(s). |
| `chain` | worker | `ChainController` connected to the worker's primary Anvil node. |
| `chains` | worker | `ReadonlyMap<number, ChainController>` over every running chain, primary included. |
| `anvil` | worker | Running primary `AnvilInstance`. |
| `extraAnvils` | worker | `ReadonlyMap<number, AnvilInstance>` for the `extraChains` instances. |
| `walletOptions` | option | Per-test overrides for wallet identity and behavior. |
| `anvilOptions` | option | Worker-level Anvil runtime overrides. |
| `extraChains` | option (worker) | `AnvilChainSpec[]` — one extra Anvil per entry, on its own chain id. |

Each test using `wallet` or `createUser` snapshots the state of **every**
running chain once before test code runs and reverts all of them after the
test finishes (one shared snapshot per test — chain state is intentionally
shared between users within a test and reverts atomically at the end).

Accounts: `walletOptions.accounts` (explicit addresses) or
`walletOptions.accountIndexes` (indexes into `chain.accounts()`) start the
wallet with several accounts; the default stays anvil account 0.
`createUser()` calls default to accounts 1, 2, 3… in creation order, inherit
the test's `walletOptions` as a base layer (so deny-mode or origin scoping
covers every user), and accept per-call overrides plus `contextOptions`
(other `test.use` context options are **not** inherited by the new context).

Multi-chain: `test.use({ extraChains: [{ chainId: 84532 }] })` boots one extra
Anvil per worker (inheriting `anvilOptions` — runtime, executable, image — with
a fixture-managed port in the band `ANVIL_PORT+1000 + workerIndex*20 + index`).
The wallet is wired so a dapp-driven `wallet_switchEthereumChain` routes all
forwarded RPC to that chain's node, and `chains.get(84532)` gives the matching
`ChainController`. User-supplied `walletOptions.chains` entries merge over the
fixture extras (user wins per key; extras are never silently dropped).

### Browser Projects

The local injected fixtures use Playwright's active `page`, `context`, and
`browser` fixtures, so they follow the current browser project. A normal
Chromium/Firefox/WebKit matrix works:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

Use `npm run test:browsers` in this repo for focused self-test coverage of
the browser-portable fixture surface. Real wallet extension fixtures are not
part of that matrix: they launch Chromium extension contexts and should live
in Chromium-only projects.

## Live Fixtures

```ts
import { expect, test } from '@marigoldlabs/web3-tester/live-fixtures';
```

Fixtures:

| Fixture | Scope | Description |
| --- | --- | --- |
| `wallet` | test | `MockWalletController` backed by a real Sepolia private-key signer. |
| `liveClient` | test | `PrivateKeyRpcClient` for Sepolia RPC and transaction submission. |

Because a real key sits behind the provider, live wallets are deny-by-default:

- `autoApprove` is `false` — signing, sending (`eth_sendRawTransaction`
  included), and wallet prompts throw `4001` until the test arms them with
  `wallet.approveNext(methods?, match?)` (single request) or
  `wallet.autoApprove(true)` /
  `test.use({ liveOptions: { walletOptions: { autoApprove: true } } })`
  (whole test, deliberate opt-in). The wallet starts pre-connected
  (`eth_accounts` answers silently), but `eth_requestAccounts` still
  requires arming — unlike real MetaMask for an already-permitted origin.
- When Playwright's `baseURL` is configured, the provider is origin-scoped to
  it: frames on any other origin (ads, embedded iframes) get no
  `window.ethereum` at all, and the RPC bridge refuses them with `4100`.
  Override with `liveOptions: { walletOptions: { allowedOrigins: [...] } }`,
  or pass `allowedOrigins: undefined` to serve every frame. Without a
  `baseURL`, every frame is served.

```ts
wallet.approveNext('personal_sign'); // arm the SIWE signature…
await page.getByRole('button', { name: 'Sign in' }).click(); // …then trigger it
```

An unbound grant approves whatever matching request arrives first; pass the
`match` predicate to pin it to the expected payload:

```ts
wallet.approveNext('personal_sign', (_method, params) =>
  String(params[0]).includes(expectedHexMessage),
);
```

Fixtures:

| Fixture | Scope | Description |
| --- | --- | --- |
| `liveOptions` | option | Per-test overrides (`walletOptions`, env names, chain). |

Required environment:

```bash
WEB3_TESTER_PRIVATE_KEY=<runtime-only-private-key>   # FJORD_PRIVATE_KEY legacy alias
```

Optional:

```bash
WEB3_TESTER_RPC_URL=https://...   # SEPOLIA_RPC_URL legacy alias
```

For other chains or env names, build your own fixture family:

```ts
import { createLiveFixtures } from '@marigoldlabs/web3-tester/live-fixtures';
import { baseSepolia } from 'viem/chains';

export const test = createLiveFixtures({
  chain: baseSepolia,
  privateKeyEnv: 'BASE_QA_PRIVATE_KEY',
  walletOptions: { autoApprove: true },
});
```

Multi-chain live testing composes through `walletOptions.chains` — one
`PrivateKeyRpcClient` per extra chain, each enforcing its own testnet guard
and RPC chain-id verification:

```ts
test.use({
  liveOptions: {
    walletOptions: {
      chains: {
        [baseSepolia.id]: new PrivateKeyRpcClient({
          privateKey,
          chain: baseSepolia,
          rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
        }),
      },
    },
  },
});
```

## Real Wallet Fixtures

```ts
import { expect, test } from '@marigoldlabs/web3-tester/real-wallet-fixtures';

test.use({
  realWalletOptions: {
    setup: { seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE },
    // Required: pick headed or headless explicitly (or set
    // WEB3_TESTER_REAL_WALLET_HEADLESS). Headed is the fully validated mode.
    headless: false,
  },
});

test('confirms a transaction', async ({ page, realWallet }) => {
  await page.goto('/');
  await realWallet.connectToDapp();
  await realWallet.confirmTransaction();
});
```

| Fixture | Scope | Description |
| --- | --- | --- |
| `realWallet` | test | `RealWalletSession` over a disposable clone of the cached profile. |
| `realWalletOptions` | option | Setup, extension path/version, baseURL, expectedAddress, generation, headless (required choice — see `launchRealWallet`), explicit profileDir. |
| `context`, `page` | test | Rebound to the persistent extension context. |

Without an explicit `profileDir`, the fixture downloads the pinned MetaMask
build (`prepareMetaMaskExtension`), walks onboarding once into a cache keyed
by (seed phrase, password, extension version), verifies the imported account
against the seed-derived address, and gives every test its own copy of that
profile — parallel-safe and onboarding-free after the first run.

Real wallet fixtures are Chromium-only. They throw during fixture setup when
used from a Firefox or WebKit Playwright project, so exclude these specs from
cross-browser projects and keep them in a dedicated Chromium project.

## MetaMask Extension Helpers

```ts
import {
  DEFAULT_METAMASK_VERSION,
  prepareMetaMaskExtension,
} from '@marigoldlabs/web3-tester/metamask-extension';

const extensionPath = await prepareMetaMaskExtension({
  version: '12.23.1',          // default: WEB3_TESTER_METAMASK_VERSION ?? pinned default
  sha256: '<optional zip digest>',
});
```

`buildWalletProfile({ extensionPath, setup, headless })` and
`cloneWalletProfile(cachedDir, targetDir)` (exported from the root entry)
manage the onboarded-profile cache directly for custom setups.
`buildWalletProfile` takes the same required `headless` choice (and optional
`generation`) as `launchRealWallet`.
For non-MetaMask Chromium wallets, use `buildWalletExtensionProfile` from the
root entry or `@marigoldlabs/web3-tester/real-wallet-cache`; it shares the
same lock/ready-marker/clone machinery but delegates onboarding to a
wallet-specific `setup.run(session)` callback.

Both current MetaMask 13.x ("multichain" UI) and the older 12.x UI are
supported as explicit configurations: the UI generation is derived from the
extension manifest at launch (overridable via the `generation` option) and
only that generation's selectors are driven — the other generation is never
probed as a fallback. 13.x (the pinned default) gates releases via the smoke
suite; 12.x is supported on a best-effort validation cadence.
`getAccountAddress()` without an `expectedAddress` returns a valid address on
both, but 13.x's multichain account tree has no single "selected" account
before a dapp connects, so on 13.x prefer passing `expectedAddress` (verified
against the wallet UI) or read the connected account from your dapp.

## Real Wallet account/token/settings surface

`RealWalletController` covers Synpress v4's MetaMask account/token/settings/
activity flows across both pinned UI generations (12.23.1 and 13.34.1):

| Method | Notes |
| --- | --- |
| `importWalletFromPrivateKey(key)` | Imports an "Imported" keyring account; throws MetaMask's inline error (e.g. duplicate). Use a non-mnemonic key — 13.x SRP discovery derives the well-known dev keys. |
| `addNewAccount(name?)` | Next derived SRP account (13.x creates it on the wallet-details page and renames via the account-details route). On 13.x the create is a background dispatch the account-tree sync can drop, so the method settles the tree and retries; on huge wallets it is reliable but not instant. `switchAccount`/`renameAccount` narrow the virtualized 13.x picker via its search box and match the exact display name. |
| `switchAccount(nameOrAddress)` | By display name (both gens) or address (best-effort on 13.x, whose cells show names). |
| `renameAccount(current, new)` | |
| `lock()` / `unlock(password?)` / `waitForUnlocked()` | `waitForUnlocked()` verifies the lock screen is gone without opening account details; use it when a test only needs to assert the wallet recovered from a lock. |
| `resetAccount()` | Clears activity/nonce data (12.x Advanced; 13.x Developer tools, with a settings-search fallback). |
| `toggleShowTestNetworks(on?)` | Idempotent with an explicit state. 13.x drives the toggle on the standalone `#/networks` page (the network picker popover hides it); enabling reveals the built-in testnets (e.g. Sepolia becomes selectable via `switchNetwork`). |
| `importToken(token)` / `approveAddToken()` (alias `addNewToken()`) / `rejectAddToken()` | Manual import and `wallet_watchAsset` approve/reject. |
| `confirmTransactionAndWaitForMining(options?)` | Confirms, waits for the activity row to reach confirmed, returns `{ txHash? }` (best-effort clipboard read — undefined on failure; the wait still completes). |
| `rejectTokenPermission()` | |

Account/network/token mutations during the cached-profile `customize` hook
survive profile close on 13.x's debounced IndexedDB persistence
(`waitForExtensionStatePersisted` waits for the flush). One caveat: a
`importWalletFromPrivateKey` inside a customize hook is best-effort — 13.x
writes the encrypted keyring in a delayed second wave whose timing is
variable, so it may not survive the profile close; prefer `addNewAccount` /
`addNetwork` / `importToken` for build-time customization, or import the key
per-test instead of baking it into the cached profile. The surface methods are
covered by focused opt-in smoke tests (`npm run smoke:real-wallet`) against the
pinned 13.x build; run the smoke before every release (see
docs/RELEASE_CHECKLIST.md). (Descoped from Synpress parity for now:
`openTransactionDetails`/`closeTransactionDetails` and the
`eth_getEncryptionPublicKey`/`eth_decrypt` helpers.)

## Real Wallet (imperative)

```ts
import { launchRealWallet } from '@marigoldlabs/web3-tester/real-wallet';

const session = await launchRealWallet({
  extensionPath: process.env.FJORD_REAL_WALLET_EXTENSION_PATH as string,
  profileDir: process.env.FJORD_REAL_WALLET_PROFILE_DIR as string,
  expectedAddress: process.env.FJORD_REAL_WALLET_ADDRESS,
  // Required: choose headed/headless explicitly (or set
  // WEB3_TESTER_REAL_WALLET_HEADLESS=true|false).
  headless: false,
  setup: process.env.FJORD_REAL_WALLET_PASSWORD || process.env.FJORD_REAL_WALLET_SECRET_RECOVERY_PHRASE
    ? {
        password: process.env.FJORD_REAL_WALLET_PASSWORD,
        seedPhrase: process.env.FJORD_REAL_WALLET_SECRET_RECOVERY_PHRASE,
      }
    : undefined,
});
```

`launchRealWallet` starts a persistent Chromium context with the configured unpacked MetaMask extension. `profileDir` can be either a dedicated Playwright user data directory or a Chrome profile directory such as `Default` or `Profile 1`; Chrome profile paths are mapped back to their user data root and launched with `--profile-directory`.

Options:

| Option | Description |
| --- | --- |
| `extensionPath` | Required path to the unpacked MetaMask extension. |
| `profileDir` | Required persistent Chromium user data directory, or a Chrome profile directory. |
| `baseURL` | Optional Playwright base URL for pages opened from the returned context. |
| `expectedAddress` | Optional account address assertion after unlock/import. |
| `extensionName` | Extension name used to resolve the extension ID. Defaults to `MetaMask`. |
| `generation` | MetaMask UI generation to drive (`'12x'` \| `'13x'`). Defaults to the major version in the extension's manifest; set explicitly for custom builds. Only the configured generation's selectors run. |
| `headless` | Required choice with no default: pass `true`/`false` here or set `WEB3_TESTER_REAL_WALLET_HEADLESS`. Launches use `channel: 'chromium'` (the full Chromium build — Playwright's headless shell cannot load extensions), so headless needs `npx playwright install chromium`. Headed is the fully validated mode; headless is validated for extension load and clipboard, not yet for the full confirmation journey. |
| `setup.password` | Optional password used to unlock MetaMask, or to import a seed phrase when onboarding is visible. |
| `setup.seedPhrase` | Seed phrase used if MetaMask opens on onboarding. When no password is supplied, web3-tester imports with a deterministic test profile password. |
| `slowMo` | Optional Playwright slow-motion delay. |

Returned session methods:

| Method | Description |
| --- | --- |
| `connectToDapp(accounts?)` | Approves a dapp connection request in MetaMask. Throws if specific `accounts` cannot be selected. |
| `confirmSignature()` | Confirms a pending signature request. |
| `confirmTransaction(options?)` | Confirms a pending transaction request (multi-step flows settle on UI state, not fixed waits). |
| `approveTokenPermission(options?)` | Approves a pending ERC-20 spending permission request. Throws if a requested `spendLimit` cannot be applied. |
| `rejectSignature()` | Rejects a pending signature request. |
| `rejectTransaction()` | Rejects a pending transaction request. |
| `addNetwork({ name, rpcUrl, chainId, symbol, blockExplorerUrl? })` | Adds a custom network through the MetaMask UI (e.g. a local Anvil node). |
| `switchNetwork(name)` | Switches MetaMask to a network by display name. |
| `approveNewNetwork()` / `rejectNewNetwork()` | Resolves a dapp-triggered `wallet_addEthereumChain` prompt. |
| `approveSwitchNetwork()` / `rejectSwitchNetwork()` | Resolves a dapp-triggered `wallet_switchEthereumChain` prompt. |
| `getAccountAddress()` | Returns the selected MetaMask account (full address). 12.x reads the header copy button; 13.x reads the account picker's Addresses view via the clipboard — prefer passing `expectedAddress` on 13.x. |
| `close()` | Closes the persistent browser context. |

Confirmation flows open `chrome-extension://<id>/notification.html` on demand
when MetaMask suppresses its popup (it does so whenever extension tabs are
open), so they work regardless of window management.

## Generic Real Wallet Extension Launcher

```ts
import { launchRealWalletExtension } from '@marigoldlabs/web3-tester/real-wallet-extension';

const session = await launchRealWalletExtension({
  extensionPath: process.env.RABBY_EXTENSION_PATH as string,
  extensionName: 'Rabby Wallet',
  profileDir: process.env.RABBY_PROFILE_DIR as string,
  headless: false,
});

const popup = session.page ?? await session.openPage('popup.html');
await session.close();
```

`launchRealWalletExtension` is the shared browser-launch seam for Rabby,
Coinbase Wallet, Phantom, OKX, Trust, Brave, and other unpacked Chromium
wallet extensions. It does not claim wallet-specific onboarding or
confirmation selectors; those adapters should build on the returned
`BrowserContext`, `extensionId`, `openPage()`, and manifest helpers.

Options:

| Option | Description |
| --- | --- |
| `extensionPath` | Required path to an unpacked Chrome extension directory. |
| `profileDir` | Required persistent Chromium user data directory, or a Chrome profile directory. |
| `extensionName` | Exact Chrome extension display name used if service-worker/runtime discovery cannot find the ID. Pass this for localized manifests. |
| `extensionId` | Known extension ID; skips discovery. Useful for preconfigured profiles or extensions without service workers. |
| `initialPage` | Extension page to open after launch. Defaults to the manifest action popup, browser action popup, options page, or side-panel path when present; pass `false` to open no extension page. |
| `headless` | Required choice with no default: pass `true`/`false` here or set `WEB3_TESTER_REAL_WALLET_HEADLESS`. Uses full Chromium via `channel: 'chromium'`. |
| `launchArgs` | Extra Chromium args appended after the extension loading args. |
| `locale`, `slowMo`, `baseURL` | Forwarded to Playwright's persistent context launch. |

Returned session:

| Property / Method | Description |
| --- | --- |
| `context` | Persistent Playwright `BrowserContext`. |
| `extensionId` | Resolved Chrome extension ID. |
| `manifest` | Parsed `manifest.json`. |
| `page` | The page opened from `initialPage`, if any. |
| `extensionUrl(page?)` | Builds `chrome-extension://<id>/<page>`. |
| `openPage(page?)` | Opens or reuses an extension page. |
| `close()` | Closes the persistent browser context. |

Helper exports include `readExtensionManifest`,
`extensionManifestName`, `extensionManifestDefaultPage`, `extensionPageUrl`,
`resolveExtensionPageUrl`, `extensionIdFromUrl`,
`openRealWalletExtensionPage`, and `discoverRealWalletExtensionId`.

For reusable real-wallet tests, prepare a non-MetaMask profile once and clone
it per test:

```ts
import {
  buildWalletExtensionProfile,
  cloneWalletProfile,
} from '@marigoldlabs/web3-tester/real-wallet-cache';

const cached = await buildWalletExtensionProfile({
  cacheKey: 'coinbase-wallet-anvil-seed-v1',
  extensionPath: process.env.COINBASE_EXTENSION_PATH as string,
  extensionName: 'Coinbase Wallet extension',
  headless: false,
  setup: {
    run: async (session) => {
      const popup = session.page ?? await session.openPage('popup.html');
      // Wallet-specific onboarding/unlock/import selectors go here.
      await popup.getByRole('button', { name: /unlock/i }).click();
    },
  },
});

const profileDir = await cloneWalletProfile(cached, '/tmp/coinbase-wallet-test-profile');
```

`cacheKey` is required and should include every external setup dependency
(seed, private key label, network config, and callback version). The manifest
name/version and extension path are included automatically. `waitForState`
defaults to true when `setup` is provided and waits for extension IndexedDB or
Local Extension Settings writes before closing; pass `waitForState: false`
when setup does not mutate persisted extension state.

For Playwright suites, use
`@marigoldlabs/web3-tester/real-wallet-extension-fixtures` to get the same
cache/clone behavior per test:

```ts
import {
  expect,
  test,
} from '@marigoldlabs/web3-tester/real-wallet-extension-fixtures';

test.use({
  realWalletExtensionOptions: {
    extensionPath: process.env.PHANTOM_EXTENSION_PATH,
    extensionName: 'Phantom',
    profileCacheKey: 'phantom-dev-wallet-v1',
    headless: false,
    profileSetup: {
      run: async (session) => {
        const popup = session.page ?? await session.openPage('popup.html');
        // Wallet-specific onboarding/unlock/import selectors go here.
        await popup.getByRole('button', { name: /unlock/i }).click();
      },
    },
  },
});

test('uses a prepared extension profile', async ({ page, realWalletExtension }) => {
  await page.goto('https://app.example.test');
  expect(realWalletExtension.extensionId).toMatch(/^[a-p]{32}$/);
});
```

Fixture options mirror `launchRealWalletExtension` plus:
`profileDir` (explicit prepared profile, bypassing the cache),
`profileCacheKey` (required without `profileDir`), `cacheDir`,
`forceProfile`, `profileSetup`, and `waitForState`.

Like `real-wallet-fixtures`, these fixtures are Chromium-only and fail fast
from Firefox or WebKit projects.

## MockWalletController

```ts
const wallet = new MockWalletController(page, rpcClient, {
  accounts: ['0x...'],
  chainId: 31337,
  // Prefer personas for EIP-6963 metadata + provider flags/aliases.
  persona: walletPersonas.rabby(),
  additionalPersonas: [walletPersonas.coinbase(), walletPersonas.phantomEvm()],
  autoApprove: true,
  connected: true,
  unlocked: true,
  // Optional Ledger/Trezor-style behavior for signing/spend methods.
  hardwareWallet: {
    approvalDelayMs: 750,
    deviceState: 'ready',
    // methods defaults to EVM/Solana signing/spend methods.
    // requiredApp / requiredApps customize wrong-app device messages.
  },
  // Optional Coinbase/Base Account provider methods. Auto-enabled by
  // walletPersonas.coinbase() / walletProfiles.coinbase(); seed fixture data
  // when tests need spend permissions or sub-accounts.
  coinbase: {
    permissions: [],
    subAccounts: [],
  },
  // Optional: more chains the wallet can switch to, keyed by chain id. Each
  // backend is an RpcClient (ChainController, PrivateKeyRpcClient, …) or an
  // http(s) RPC URL string (wrapped via httpRpcClient). The positional
  // rpcClient stays the backend for `chainId`.
  chains: { 84532: otherChainController, 10: 'http://127.0.0.1:19703' },
  // Optional: honor dapp-supplied rpcUrls[0] in wallet_addEthereumChain
  // after a bounded eth_chainId probe. Never enable over a real key.
  trustDappRpcUrls: false,
  // Optional, http(s) origins only: the provider installs (and the bridge
  // answers) only in frames on these origins; everything else sees no
  // window.ethereum and gets 4100 from the bridge. Same-origin about:blank
  // and srcdoc children inherit their parent's origin. Unset serves every
  // frame, like a real extension.
  allowedOrigins: ['https://app.example.com'],
});
await wallet.injectMockProvider();
```

Properties:

| Property | Type | Description |
| --- | --- | --- |
| `primaryAccount` | `Address` | First exposed account. |
| `currentChainId` | `Hex` | Current EIP-1193 chain ID. |
| `providerInfo` | `WalletProviderInfo` | Primary EIP-6963 provider metadata. |
| `providerInfos` | `WalletProviderInfo[]` | All announced provider metadata. |
| `coinbasePermissions` | `CoinbasePermission[]` | Seeded Coinbase/Base Account spend permissions, cloned for test assertions. |
| `coinbaseSubAccounts` | `CoinbaseSubAccount[]` | Seeded and generated Coinbase/Base Account sub-accounts, cloned for test assertions. |
| `solanaAccounts` | `{ publicKey, pubkey, address }[]` | Visible Solana persona accounts for `solana_getAccounts` / `solana_requestAccounts`; empty while locked, disconnected, or when no Solana persona is configured. |
| `isUnlocked` | `boolean` | Current software wallet lock state exposed through `_metamask.isUnlocked()` and `metamask_getProviderState`. |

Methods:

| Method | Description |
| --- | --- |
| `injectMockProvider()` | Adds the RPC bridge and injects `window.ethereum` context-wide (popups and dapp-opened tabs included). One controller per browser context. |
| `autoApprove(enabled)` | Toggles automatic approval for signing methods, `eth_requestAccounts`, and `wallet_*` prompt methods. |
| `configureHardwareWallet(options)` | Enables or disables deterministic Ledger/Trezor-style device simulation. `true` uses defaults; an object can set `approvalDelayMs`, `deviceState`, method coverage, and `requiredApp` / `requiredApps` wrong-app messages. |
| `configureCoinbaseWallet(options)` | Enables, disables, or reseeds Coinbase/Base Account RPC simulation after construction. Objects can set seeded spend permissions, sub-accounts, and default generated sub-account factory data. |
| `setHardwareWalletState(state)` | Sets `ready`, `locked`, `wrong-app`, `blind-signing-disabled`, or `disconnected` and enables hardware simulation. Non-ready states reject matching requests. |
| `setHardwareWalletApprovalDelay(ms)` | Sets the ready-device confirmation delay. |
| `lock()` / `unlock()` / `setUnlocked(boolean)` | Simulates the wallet software lock. Locking keeps chain connectivity, hides accounts, emits `accountsChanged: []`, rejects approval-gated account/sign/spend prompts with `4100`, and makes `_metamask.isUnlocked()` false. Unlocking restores accounts for connected wallets. |
| `approveNext(methods?, match?)` | Arms approval for the next matching request while autoApprove is off — the explicit per-call grant for real-key wallets. `match(method, params)` binds the grant to an expected payload. Queued rejections and holds take precedence; grants do not expire until consumed. |
| `simulateRejection(methods?, message?)` | Rejects the next matching request with code `4001`. The default method set covers all approval-gated methods. |
| `holdNextRequest(methods?)` | Keeps the next matching request pending until the returned `HeldRequest` is approved or rejected — for "confirm in your wallet" UI states. |
| `waitForNextTransaction(options?)` | Resolves with the hash of the next transaction the page submits. |
| `waitForNextWatchedAsset(options?)` | Resolves with the next approved `wallet_watchAsset` request record. |
| `setAccounts(accounts, { allowUnknownAccounts? })` | Replaces the account set, **reconnects a disconnected wallet**, validates against the node's `eth_accounts`, and emits `accountsChanged`. |
| `switchAccount(address)` | Re-selects an existing account: moves it to index 0 (MetaMask's most-recently-selected-first order) and emits `accountsChanged`. No event when already selected; unlike `setAccounts`, does **not** reconnect while disconnected. |
| `currentAccounts` | Current account list; index 0 is the selected account. |
| `disconnect()` | Emits `accountsChanged` and `disconnect`; signing while disconnected throws `4100`. |
| `reconnect()` | Emits `connect` and `accountsChanged`. |
| `switchNetwork(chainId)` | Updates chain ID, marks it known, and emits `chainChanged` (injected EVM providers also fan out legacy `networkChanged`; no event for a same-chain switch). |
| `addChain(chainId, backend)` | Test-side chain registration (Synpress `addNetwork` analogue): no approval gate, no probe, re-registration overwrites. |
| `backedChainIds` | Chain ids that currently have an RPC backend, canonical hex. |
| `handleExternalRequest(request, { origin }?)` | Dispatch a request from a non-injected transport (e.g. WalletConnect) through the same approval gating; `allowedOrigins` is enforced against `origin`. |
| `onProviderEvent(listener)` | Observe provider events node-side (fire-and-forget); returns an unsubscribe function. |

Transaction recording: `sentTransactions: Hex[]` and
`sentTransactionRequests: SentTransactionRecord[]`.
Approved token-watch prompts are recorded in
`watchedAssets: WatchedAssetRecord[]`; call
`waitForNextWatchedAsset()` before triggering the dapp action to await the
next approved `wallet_watchAsset` request. `wallet_watchAsset` validates the
request object before prompting; malformed requests and invalid ERC-20
addresses return `-32602` without consuming queued approvals or recording an
asset.

Chain semantics follow MetaMask: dapp-initiated `wallet_switchEthereumChain`
validates first (`-32602`), then throws `4902` for unknown chains *before*
any approval prompt; `wallet_addEthereumChain` requires `rpcUrls` (a
non-empty array of valid URLs, per EIP-3085), registers, and switches;
`wallet_requestPermissions` and `wallet_revokePermissions` support
`eth_accounts` permission objects (and keep the legacy no-param path as
`eth_accounts`); unsupported permission keys return `4200` without changing
connection state. `wallet_revokePermissions` revokes account authorization
when `eth_accounts` is revoked: `eth_accounts` becomes empty and
`accountsChanged` emits `[]`, while EIP-1193 chain connectivity stays intact
(`isConnected()` remains true and no `disconnect` event fires). Unknown
`wallet_*` methods return
`4200` instead of leaking node errors; all other unhandled methods are
forwarded to the **active chain's** RPC backend.

Injected EVM providers expose the common EIP-1193/EventEmitter method shape:
`request`, `enable`, legacy `send(method, params)`, `send(payload)`,
`send(payload, callback)`, `send(payload[], callback)`,
`sendAsync(payload, callback)`, `sendAsync(payload[], callback)`, `on`,
`once`, `addListener`, `removeListener`, `off`, `removeAllListeners`,
`listeners`, and `listenerCount`. Batch payload arrays resolve to result
arrays for promise-style `send` and JSON-RPC response arrays for callback
style `send`/`sendAsync`, including per-payload `error` objects when only part
of a batch fails. Already-connected wallets emit an initial
`connect` event after page scripts have had a chance to attach listeners, and
subsequent `connect`, `disconnect`, `accountsChanged`, and `chainChanged`
events stay synchronized across `window.ethereum`, EIP-6963 providers, and
legacy provider aliases. `chainChanged` also emits the legacy
`networkChanged` alias with the decimal `networkVersion` payload for older
dapps.
`eth_subscribe` and `eth_unsubscribe` are intentionally not implemented; they
return a wallet-shaped `4200` instead of forwarding to the backing HTTP RPC
node. Use direct viem/WebSocket clients when a test needs subscription
streams.
`walletOptions.unlocked: false` or `wallet.lock()` simulates a locked software
wallet without disconnecting from the chain: `isConnected()` remains true,
`eth_accounts`, `wallet_getPermissions`, `selectedAddress`, and
`metamask_getProviderState.accounts` are empty, `_metamask.isUnlocked()` and
`metamask_getProviderState.isUnlocked` are false, and approval-gated
account/sign/spend prompts return `4100` until `wallet.unlock()`.

Account semantics: `eth_sendTransaction` rejects a `from` outside
`currentAccounts` with `4100` (MetaMask-faithful — anvil would happily sign
with any unlocked dev account). Wallet accounts are validated against the
node's `eth_accounts` at injection/`setAccounts` time; the check fails open
when the node cannot answer (live RPC endpoints, custom clients — and it is
best-effort under `anvil --auto-impersonate`). Impersonated accounts
(`chain.impersonateAccount`) validate without any flag because anvil lists
them — sends work, but `personal_sign`/typed-data still fail node-side with
`-32602` since anvil holds no key.

Hardware-wallet simulation runs after a request is otherwise approved: queued
rejections still win, `approveNext` arms the user approval while preserving
device checks, and `holdNextRequest` remains an explicit manual gate. The
default hardware method set covers `eth_sendTransaction`, `eth_sign`,
`personal_sign`, `eth_signTypedData_v3`, `eth_signTypedData_v4`,
`wallet_sendCalls`, and Solana signing methods such as `solana_signIn`,
`solana_signMessage`, and `solana_signTransaction`; override `methods` to
narrow or broaden it.
`wrong-app` errors infer the required app from the method (`Ethereum` for EVM,
`Solana` for `solana_*` methods), with `requiredApp` and method-specific
`requiredApps` overrides for custom apps. The same simulation applies to
injected-provider requests and external transports such as WalletConnect via
`handleExternalRequest`.

### Coinbase/Base Account methods

`walletPersonas.coinbase()` and `walletProfiles.coinbase()` auto-enable the
Coinbase/Base Account provider methods: `wallet_connect`,
`wallet_addSubAccount`, `wallet_getSubAccounts`,
`coinbase_fetchPermissions`, and `coinbase_fetchPermission`. Other personas
return `4200` for those methods unless `coinbase: true` or a `coinbase` config
object is passed.

Seed spend permissions and sub-accounts through `walletOptions.coinbase`,
`walletProfiles.coinbase({ coinbase: ... })`, or
`wallet.configureCoinbaseWallet(...)`:

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
        factory: '0x0000000000000000000000000000000000000005',
        factoryData: '0x1234',
      }],
    },
  }),
});
```

`wallet_connect` returns Coinbase's account-object connection response and
supports the `signInWithEthereum` capability with a deterministic SIWE message
signed by the backing chain account. `wallet_addSubAccount` supports `create`
and `deployed` account configs, stores the result for later
`wallet_getSubAccounts` calls, and is approval-gated. `coinbase_fetchPermissions`
filters active seeded spend permissions by spender, chain, optional account,
and decimal cursor pagination; `coinbase_fetchPermission` fetches one
permission by hash. Account-linked Coinbase methods respect software lock
state: locked wallets return `4100` for `wallet_connect`,
`wallet_addSubAccount`, `wallet_getSubAccounts`,
`coinbase_fetchPermissions`, and `coinbase_fetchPermission`.

### EIP-5792 batch calls

Enabled by default (like 2026 MetaMask): `wallet_getCapabilities` answers per
backed chain with `{ atomic: { status } }` (configure via
`eip5792: { atomic, capabilities, maxCallsPerBatch }`, or `eip5792: false`
for a legacy wallet that returns `4200`). `wallet_sendCalls` validates
MetaMask-faithfully — `-32602` malformed/wrong version, `4100` foreign
`from`, `5710` non-active chain, `5720` duplicate id, `5740` oversize,
`5700` unknown non-optional capability, `5760` atomic-unsupported, `5750`
upgrade rejection (arm with `wallet.simulateAtomicUpgradeRejection()`) —
then **one** approval gates the whole batch (`approveNext('wallet_sendCalls')`
arms all N calls; in live mode that would be N real transactions, which is
why live fixtures ship `eip5792: false`).

Execution is receipt-status-checked: anvil mines reverting calls with status
`0x0`, so each call's receipt is verified and an atomic batch is rolled back
via `evm_snapshot`/`evm_revert` on the first failure. `wallet_getCallsStatus`
returns spec codes — `100` pending, `200` confirmed, `400` nothing landed,
`500` reverted completely (receipts omitted for rolled-back atomic batches —
a documented divergence from real MetaMask's single 7702 receipt), `600`
partial. Batches are recorded in `wallet.sentCallBatches` (and each call in
`sentTransactions`). With `blockTime > 0`, receipts are not synchronously
available: atomic mode then only rolls back submission-time failures, and
status stays `100` until mining. A `ready` wallet upgrades to `supported`
after its first successful `atomicRequired` batch.

### EIP-7702 helpers (ChainController)

`chain.signAuthorization({ account, contractAddress, nonce?, chainId?, executor? })`,
`chain.delegate({ account, contractAddress, sponsor? })` (type-4 tx from an
unlocked sponsor; `sponsor === authority` self-executes with viem's nonce+1
handling), `chain.revokeDelegation({ account })` (zero-address authorization),
and `chain.getDelegation(authority)` (parses the `0xef0100‖address`
designator, `null` when not delegated). `account` is a viem local account or
a raw private key — anvil's default-mnemonic keys keep tests hermetic.
`PrivateKeyRpcClient` now maps `authorizationList` through
`eth_sendTransaction` (hex→number coercion, loud on malformed entries) and
exposes `signAuthorization()` for live 7702 tests.

Multi-chain routing: every forwarded method (reads, `eth_sendTransaction`,
`eth_sendRawTransaction`, signing) goes to the backend registered for the
wallet's current chain. Switching to a known-but-unbacked chain succeeds
(wallet-local `eth_chainId`/mirrors update, so wrong-network-banner tests
work) — but forwarded calls then throw `4901` (EIP-1193 "Chain
Disconnected") instead of silently hitting the wrong node. Transactions are
recorded with the `chainId` they executed on. Caveats: chain-scoped node
state (e.g. `eth_newFilter` ids) does not survive a switch — the next poll
hits a different node; and URL-backed chains cannot service node-side
signing (`personal_sign`, `eth_sendTransaction`) — back chains that must
sign with Anvil or a `PrivateKeyRpcClient`.

Supported wallet methods include:

- `eth_accounts`
- `eth_requestAccounts`
- `eth_chainId`
- `net_version`
- `eth_subscribe` / `eth_unsubscribe` return `4200` (subscription streams are not implemented)
- `wallet_getPermissions`
- `wallet_requestPermissions` (`eth_accounts` permission only; unsupported permissions return `4200`)
- `wallet_connect` (Coinbase/Base Account simulation)
- `wallet_addSubAccount` (Coinbase/Base Account simulation)
- `wallet_getSubAccounts` (Coinbase/Base Account simulation)
- `coinbase_fetchPermissions` (Coinbase/Base Account simulation)
- `coinbase_fetchPermission` (Coinbase/Base Account simulation)
- `wallet_switchEthereumChain`
- `wallet_addEthereumChain`
- `wallet_watchAsset`
- `metamask_getProviderState`
- `eth_sendTransaction`
- `eth_sendRawTransaction` (approval-gated like a spend; recorded in `sentTransactions`)
- `personal_sign`
- `eth_sign`
- `eth_signTypedData_v3` (signed via the backend's v4 path)
- `eth_signTypedData_v4`
- `wallet_revokePermissions` (`eth_accounts` permission only; unsupported permissions return `4200`)

`eth_signTypedData` (legacy v1) returns `4200`.

## Wallet Personas

```ts
import { walletPersonas, walletProfiles } from '@marigoldlabs/web3-tester/wallet-personas';

test.use({
  walletOptions: {
    persona: walletPersonas.rabby(),
    additionalPersonas: [
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

Built-in personas cover MetaMask, Rabby, Coinbase Wallet, Phantom EVM,
Rainbow, OKX, Trust, Brave, Zerion, Backpack, Solflare, Ledger, Trezor, Safe,
Bitget, TokenPocket, SafePal, Binance Wallet, imToken, MathWallet, Frame,
Enkrypt, Core, Frontier, OneKey, CTRL, Uniswap Wallet, Argent, Exodus, and
Fireblocks. A persona supplies EIP-6963 metadata,
provider boolean flags (for example `isRabby`, `isCoinbaseWallet`,
`isPhantom`, `isBitKeep`, `isTokenPocket`, `isBinance`,
`isUniswapWallet`, `isArgent`, `isExodus`, `isFireblocks`), optional global
aliases (for example `window.phantom.ethereum`), legacy
`window.ethereum.providers` entries when multiple personas are configured, and
WalletConnect peer metadata. Each injected EVM provider also exposes a frozen
`provider.info` object with the same `{ uuid, name, icon, rdns }` identity used
for EIP-6963 announcements, including entries inside
`window.ethereum.providers` and known alias globals. The
controller behavior remains shared: persona selection changes how the wallet
is discovered, not how approvals or chain routing are handled. Legacy
`providerInfo` / `additionalProviders` still work for EIP-6963-only metadata.
Set `evm: false` on a custom persona for Solana-only wallets; such personas
skip `window.ethereum`, EIP-6963 announcements, and legacy EVM provider arrays.
Known globals are included where they are part of common EVM discovery:
`window.coinbaseWalletExtension`, `window.phantom.ethereum`,
`window.okxwallet`, `window.trustwallet`, `window.backpack.ethereum`,
`window.bitkeep.ethereum`, `window.tokenpocket.ethereum`,
`window.safepalProvider`, `window.binancew3w.ethereum`, `window.imToken`,
`window.enkrypt.providers.ethereum`, `window.avalanche`,
`window.frontier.ethereum`, `window.$onekey.ethereum`,
`window.ctrl.ethereum`, and `window.xfi.ethereum`.
The Brave persona sets both `isBraveWallet` and `isMetaMask` for
MetaMask-compatible Brave Wallet selectors.
Phantom, Backpack, SafePal, and Solflare also expose lightweight Solana provider surfaces:
`window.phantom.solana`, `window.solana` for Phantom, and
`window.backpack.solana` for Backpack, `window.safepal` for SafePal, and
`window.solflare` for Solflare. Solflare is Solana-only (`evm: false`), so it
does not create an Ethereum provider. They
also register Wallet Standard wallets via the `wallet-standard:register-wallet` /
`wallet-standard:app-ready` event handshake used by Solana Wallet Adapter.
The Solana provider aliases also expose the same frozen `provider.info`
identity object as their EVM counterpart or persona.
The simulated Solana provider supports `connect`, `disconnect`, `request`,
`signIn`, `signMessage`, `signTransaction`, `signAllTransactions`,
`signAndSendTransaction`, `signAndSendAllTransactions`, and the same
EventEmitter-style listener aliases
(`on`, `once`, `addListener`, `removeListener`, `off`, `removeAllListeners`,
`listeners`, `listenerCount`). `request({ method: 'getAccounts' })` and
`request({ method: 'requestAccounts' })` return base58 public-key strings;
`solana_getAccounts` and `solana_requestAccounts` return account objects with
`publicKey`, `pubkey`, and `address` for namespace-prefixed wallet probes.
`connect({ onlyIfTrusted: true })` and Wallet
Standard `connect({ silent: true })` reject before the first successful
authorization, then reconnect silently after a prior `connect`/`signIn` even
if the live session was disconnected. Controller `wallet.lock()` hides a
connected direct Solana provider by clearing `publicKey`/`isConnected` and
emitting Wallet Standard `accounts: []`; `wallet.unlock()` restores providers
that were connected before the lock, while `wallet.disconnect()` emits the
Solana provider `disconnect` event. First-time Solana `connect`, direct
Solana signing, Solana `signIn`, and Wallet Standard signing calls route
through the same controller approval, rejection, hold, and hardware-wallet
gates as EVM requests (`approveNext('solana_signMessage')`,
`holdNextRequest('solana_signTransaction')`, etc.). Wallet Standard registration
includes `solana:signIn`, `solana:signMessage`, `solana:signTransaction`, and
`solana:signAndSendTransaction`. It is intended for wallet selector,
connection, and auth/signing UI tests; it does not provide a Solana validator
or real Solana transaction submission. Custom personas can override the
default Wallet Standard chains through `solana: { chains: [...] }`.

`walletProfiles` returns fixture-ready option objects for the same wallets.
Most profiles set only `persona`; `walletProfiles.coinbase({ coinbase })`
can also seed Coinbase/Base Account data, while `walletProfiles.ledger()` and
`walletProfiles.trezor()` enable `hardwareWallet` by default:

```ts
test.use({
  walletOptions: walletProfiles.trezor({
    hardwareWallet: { deviceState: 'blind-signing-disabled', approvalDelayMs: 0 },
  }),
});
```

## Safe

`@marigoldlabs/web3-tester/safe` provides the Safe Transaction Service surface
needed for multisig workflow tests. Transaction Service support is first-class:
the REST client can propose transactions, submit confirmations, fetch a
transaction by Safe transaction hash, list a Safe's multisig transactions, and
list confirmations.

```ts
import {
  SafeTransactionServiceClient,
  SafeWalletHarness,
  hashSafeTransactionTypedData,
} from '@marigoldlabs/web3-tester/safe';

const service = new SafeTransactionServiceClient({
  // Include the prefix your deployment exposes, commonly /api/v1.
  baseUrl: 'https://safe-transaction-sepolia.safe.global/api/v1',
  chainId: 11155111,
});

const safe = new SafeWalletHarness({
  safeAddress,
  owners: [owner1, owner2],
  threshold: 2,
  chainId: 11155111,
  transactionService: service,
});

const proposed = await safe.proposeTransaction({
  proposer: owner1,
  transaction: { to, value: 1n, data: '0x' },
  origin: 'qa-run',
});
await safe.confirmTransaction(proposed.safeTxHash, { owner: owner2, signature });
```

For hermetic tests use `InMemorySafeTransactionService`; it implements the
same propose/confirm/list/get contract without a network service. When a
`SafeWalletHarness` is constructed with an `rpcClient`, `executeTransaction`
enforces the configured threshold, broadcasts the transaction data from the
executor address through `eth_sendTransaction`, and marks the local service
record executed when the service supports `markExecuted`.

`SafeWalletHarness` defaults to protocol-compatible EIP-712 Safe transaction
hashes. `SafeTransactionServiceClient` also computes EIP-712 `safeTxHash`
values when `chainId` is configured; otherwise pass `safeTxHash` explicitly
for real deployments. Use `hashSafeTransactionTypedData(safeAddress, chainId,
tx)` or `buildSafeTransactionTypedData(...)` when tests need to assert the
Safe.sol hash input directly. `hashSafeTransactionData` remains as a
deterministic fixture hash, and can be selected on the harness/client with
`safeTxHashStrategy: 'fixture'`.

```ts
const safeTxHash = hashSafeTransactionTypedData(safeAddress, 11155111, {
  to,
  value: 1n,
  data: '0x',
  nonce: 0,
});
```

Safe App iframe simulation is available through `injectSafeAppBridge(page,
safe, options?)`. It installs a parent-page `postMessage` responder compatible
with Safe Apps SDK v1 messages (`{ id, method, params, env: { sdkVersion } }`)
and returns SDK-shaped success/error envelopes. Supported methods include
`getSafeInfo`, `getChainInfo`, `sendTransactions`, `getTxBySafeTxHash`,
`rpcCall`, `signMessage`, `signTypedMessage`, `getOffChainSignature`,
`wallet_getPermissions`, `wallet_requestPermissions`, `requestAddressBook`,
and `getSafeBalances`.

`getSafeInfo` returns the extended Safe Apps SDK shape: `safeAddress`,
`chainId`, `threshold`, `owners`, `isReadOnly`, `nonce`, `implementation`,
`modules`, `fallbackHandler`, `guard`, and `version`. Override the mutable
metadata through `options.safeInfo`; otherwise the bridge uses the harness
owners/threshold/current nonce and inert defaults. `getChainInfo` returns the
Safe Gateway `blockExplorerUriTemplate.txHash` key; the bridge still accepts a
legacy `tx` option alias and maps it to `txHash`. `getSafeBalances` returns
`{ fiatTotal, items }`; pass either that full object or a bare balance-item
array, which is wrapped as `{ fiatTotal: '0', items }` for compatibility.
When `options.allowedOrigins` is configured, untrusted origins and missing or
`null` iframe origins are rejected. Multi-call `sendTransactions` requests are
encoded as a delegatecall to Safe MultiSendCallOnly
(`SAFE_MULTISEND_CALL_ONLY_ADDRESS`); pass `options.multiSendAddress` for
custom deployments.

```ts
await page.setContent('<iframe id="safe-app"></iframe>');
await injectSafeAppBridge(page, safe, {
  chainInfo: { chainName: 'Anvil Local', shortName: 'anvil' },
  addressBook: [{ address: owner1, chainId: '31337', name: 'Owner 1' }],
  balances: { fiatTotal: '0', items: [] },
});
await page.locator('#safe-app').evaluate((iframe, srcdoc) => {
  (iframe as HTMLIFrameElement).srcdoc = srcdoc;
}, appHtml);
```

## WalletConnect

`@marigoldlabs/web3-tester/walletconnect` is a headless WalletConnect v2
wallet peer that pairs with a dapp's AppKit/WC modal and answers every
`session_request` through the `MockWalletController` — so
`approveNext`/`autoApprove`/`holdNextRequest`/`simulateRejection` and
`sentTransactions`/`waitForNextTransaction` plus
`watchedAssets`/`waitForNextWatchedAsset` govern WC traffic exactly like
injected traffic, in mock and live modes. Requires the optional peers
(`npm i -D @walletconnect/sign-client @walletconnect/utils
@walletconnect/types`); the core install stays dependency-free, but note
the git-install cost: they land in this repo's devDependencies, which
consumers' `npm install <git>` will fetch.

```ts
const wc = await WalletConnectWallet.create({
  wallet,
  projectId: process.env.WEB3_TESTER_WC_PROJECT_ID!,
  persona: walletPersonas.coinbase(),
});
try {
  await page.getByText('WalletConnect').click();   // open the QR view
  wallet.approveNext('eth_requestAccounts');       // arms the session approval
  const session = await wc.connect(page);          // wui-qr-code uri → pair → settle
  // …drive the dapp; session_requests hit the wallet's gating…
} finally {
  await wc.close();                                // always — relay teardown
}
```

Semantics: session proposals gate as a synthetic `eth_requestAccounts`
(`approveNext` match callbacks receive the proposal payload — proposer
metadata, verified origin — for targeting); requests on approved-but-inactive
chains switch the wallet first (single-active-chain semantics, `chainChanged`
emitted); off-namespace chains answer `5100`; wallet errors
(4001/4100/4200/4902/-32602) cross the relay verbatim. `allowedOrigins` is
enforced against the relay's verifyContext origin (`enforceOrigins: false`
opts out — when Verify reports UNKNOWN validation the origin is unattested).
Wallet events push to sessions (`chainChanged` extends the namespace first,
like MetaMask mobile; EVM `accountsChanged` refreshes non-empty CAIP account
lists in the namespace before emitting; Solana namespaces receive
`accountsChanged` with Solana public keys or `[]` when the wallet
locks/disconnects); `wallet.disconnect()`
ends WC sessions too. One-Click
Auth (SIWE) `session_authenticate` is handled by default: the wallet signs
CAIP-122 Cacao objects through the same `eth_requestAccounts` and
`personal_sign` approval gates, enforces the approved EIP-155 chains, and
stores any authenticated session returned by SignClient. Pass
`sessionAuthenticate: false` to `WalletConnectWallet.create()` to use
sign-client's fallback session-proposal + `personal_sign` path instead.
Storage is in-memory (nothing on disk); SignClient init sets
`disableRequestQueue` so a held request cannot starve later ones. When a test
creates a dapp SignClient and a wallet SignClient in the same Node process, keep
their WalletConnect Core instances isolated with distinct
`customStoragePrefix` values; `WalletConnectWallet.create()` accepts
`customStoragePrefix` and otherwise assigns a unique web3-tester wallet prefix.

The default EVM namespace advertises the mock wallet's modern EVM surface,
including EIP-5792 batch methods: `wallet_getCapabilities`,
`wallet_sendCalls`, `wallet_getCallsStatus`, and `wallet_showCallsStatus`.
Those requests dispatch through the same `MockWalletController` handlers as
injected traffic, so batch approval gates, atomic execution, status records,
and `wallet.sentCallBatches` work over WalletConnect too.

When the selected persona is `walletPersonas.coinbase()`, the approved EVM
namespace also advertises Coinbase/Base Account methods by default:
`wallet_connect`, `wallet_addSubAccount`, `wallet_getSubAccounts`,
`coinbase_fetchPermissions`, and `coinbase_fetchPermission`. Pass
`methods: [...]` to `WalletConnectWallet.create()` when a test needs a custom
namespace instead.

When the selected persona has a Solana provider (`walletPersonas.phantomEvm()`,
`walletPersonas.backpack()`, `walletPersonas.safePal()`,
`walletPersonas.solflare()`), WalletConnect also advertises a `solana`
namespace by default. Personas with `evm: false` (Solflare) publish Solana
without `eip155` unless `evm: true` is passed explicitly. Override or force
Solana with `solana: { chains, publicKey, methods, events }`, or pass
`solana: false` to publish only EVM namespaces. Supported Solana WC methods are
`solana_getAccounts`, `solana_requestAccounts`, `solana_signIn`,
`solana_signMessage`, `solana_signTransaction`, `solana_signAllTransactions`, and
`solana_signAndSendTransaction`; the compatibility set also includes
`solana_signAndSendAllTransactions` for wallets/dapps that expose Phantom-style
batch send APIs. These requests use the same controller gates as EVM WC traffic:
`autoApprove(false)`, `approveNext('solana_signIn')`,
`approveNext('solana_signMessage')`, `holdNextRequest('solana_signTransaction')`,
`simulateRejection(...)`, and hardware-wallet simulation all apply. Responses
are deterministic mock signatures; no Solana RPC backend is started.

URI extraction keeps AppKit's `wui-qr-code[uri]` contract as the first-class
path, then probes generic URI attributes (`uri`, `data-uri`, `href`, `value`),
text/value elements (`textarea`, `input`, `code`, `pre`, `[data-wc-uri]`),
and AppKit's `copy-wc2-uri` clipboard button. For unusual modals pass
`selector` / `selectors`, `textSelectors`, `copyButtonSelector`, or a custom
`getUri(page)` hook.

Personas also carry WalletConnect launch templates where the wallet ecosystem
has a stable URI format. Use `formatWalletConnectUriForPersona(uri, persona)`
for mobile handoff tests, or pass `'qrCode'` as the third argument when a
wallet's QR flow should preserve the raw `wc:` URI. The helper falls back to
the raw URI when no verified template is configured, and
`walletConnectMetadataForPersona()` intentionally returns only standard
SignClient peer metadata (`name`, `description`, `url`, `icons`).

Pairing needs the real relay: the live suite is env-gated on
`WEB3_TESTER_WC_PROJECT_ID` (free Reown project id) and never gates CI; the
gating/error/URI logic is covered hermetically.

## Transaction assertion matchers

The `expect` exported by every fixture module (and `./matchers`) carries
hardhat-chai-matchers-style web3 matchers. The chain is always an explicit
argument (`ChainLike`: a `ChainController`, a `PrivateKeyRpcClient` — via its
`client` getter — or any viem `PublicClient`), so the matchers are
mode-agnostic.

| Matcher | Receiver | Description |
| --- | --- | --- |
| `toEmitEvent(chain, abi, eventName, { args?, address?, count?, timeout? })` | tx hash / `{ hash }` / promise | Decodes receipt logs; `args` named or positional (positional `undefined` = wildcard), values may be predicates (`anyValue` exported). `count` asserts an exact match count; default ≥ 1, and `.not` asserts zero matching. Failure lists every decoded event (and undecodable logs by `topic0`), flagging reverted receipts. |
| `toChangeBalance(s)(chain, …, { includeFee? })` | tx ref | Balance delta between the receipt block and its parent. The sender's gas fee is **excluded** by default (hardhat parity); `includeFee: true` includes it. Multi-tx blocks are flagged in failures. |
| `toChangeTokenBalance(s)(chain, token, …)` | tx ref | Same, reading `balanceOf` at the two heights. |
| `toBeReverted(chain)` / `toBeRevertedWith(chain, reason\|RegExp)` / `toBeRevertedWithCustomError(chain, abi, name, { args? })` / `toBeRevertedWithPanic(chain, code?)` | promise, function, or tx ref | Rejected promises decode revert data from the error's cause chain; mined reverted transactions replay at the parent block with a `debug_traceTransaction` fallback. Exact-string or RegExp reasons (hardhat semantics). Wallet approval failures (4001/4100) are rethrown with a hint, never counted as reverts. |
| `toHaveTokenBalance(chain, token, expected)` | holder address | Single `balanceOf` read; `expected` exact or predicate. Non-retrying — use `expect.poll(() => holder).toHaveTokenBalance(…)` for eventual consistency. Refuses 32-byte receivers. |

Compose with your own matchers via `mergeExpects(web3Expect, yours)` or
`baseExpect.extend({ ...web3Matchers, ...yours })`. Matchers surface on
`expect(x)` only when `x` is typed `Hex`/`Address` (everything the library
hands out already is). `chain.waitForTransaction(hash, { abi })` returns the
receipt with decoded logs and the recovered revert reason.

## ChainController

`ChainController` wraps a Viem Anvil test client.

| Method | Description |
| --- | --- |
| `snapshot()` | Calls `evm_snapshot`. |
| `revert(id)` | Calls `evm_revert`. |
| `accounts()` | Returns Anvil default accounts. |
| `request(request)` | Sends a raw JSON-RPC request. |
| `impersonateAccount(address)` | Starts Anvil account impersonation. |
| `stopImpersonatingAccount(address)` | Stops Anvil account impersonation. |
| `setBalance(address, value)` | Sets an account balance. |
| `fastForward(seconds)` | Increases time and mines one block. |
| `mine(blocks)` | Mines blocks. |

The underlying Viem test client is available as `chain.client` for advanced calls.

### Seeding tokens and deploying contracts

`chain.*` helpers are cheatcodes (forge-style): they bypass the wallet
entirely — no approval gating, no `wallet.sentTransactions` record.

| Method | Description |
| --- | --- |
| `deployContract({ abi, bytecode, args?, from?, value? })` | Deploys through an Anvil unlocked account; resolves `{ address, hash, receipt }`, throwing on a reverted constructor. |
| `deployErc20(options?)` | Deploys the committed `TestERC20` artifact (classic layout, open mint/burn — never deploy where value lives). Options: `name`, `symbol`, `decimals`, `initialSupply`, `mintTo`, `from`. |
| `dealErc20(token, account, amount, options?)` | forge-std `deal` parity: sets any standard ERC-20 balance via slot discovery (Solidity + Vyper layouts, OZ-v5 ERC-7201 roots), with a per-token slot cache. Options: `adjustTotalSupply`, `slot`/`layout`, `storageAddress`, `maxSlot`. |
| `getErc20Balance(token, account)` | `balanceOf` without importing an ABI. |
| `setStorageAt(address, slot, value)` / `setCode(address, bytecode)` / `setNonce(address, nonce)` | Thin anvil cheat passthroughs. |

Discovery never writes: candidates are probed with `eth_call` state
overrides, so a crash mid-discovery cannot dirty the chain; the single final
write is verified against `balanceOf` (including cache hits — a stale cache
entry from address reuse after a snapshot revert is evicted and rediscovered
once). Not dealable by probing: rebasing/shares tokens (stETH, aTokens)
whose `balanceOf` is computed, and solady-style seeded layouts (use
`chain.setStorageAt` with a hand-computed slot). External-storage proxies
need `{ storageAddress }`. Failures throw `Erc20DealError` naming the
remediation; pointing `dealErc20` at a non-anvil client (live chains) fails
with a clear error.

Fork recipe: with `ANVIL_FORK_URL` (and ideally `ANVIL_FORK_BLOCK_NUMBER`
via `anvilOptions.forkBlockNumber` for determinism), `dealErc20` works on
real mainnet tokens — reads fall through to the upstream RPC, the write
overlays locally, and the slot cache makes repeat deals cheap. Combine with
`chain.impersonateAccount(whale)` for send-only whale flows.

## AnvilInstance

```ts
const anvil = await AnvilInstance.start({
  runtime: 'docker',
  port: 8546,
  chainId: 31337,
});

await anvil.stop();
```

Options:

| Option | Description |
| --- | --- |
| `runtime` | `binary` or `docker`. |
| `executable` | Anvil binary path for `binary` runtime. |
| `dockerImage` | Foundry Docker image. |
| `host` | Host interface. |
| `port` | Host RPC port. |
| `chainId` | Local chain ID. |
| `accounts` | Number of generated accounts. |
| `balance` | ETH balance per generated account. |
| `mnemonic` | Deterministic mnemonic. |
| `blockTime` | Optional automatic mining interval. |
| `forkUrl` | Optional fork RPC URL. |
| `forkBlockNumber` | Optional pinned fork block (deterministic fork tests). |
| `extraArgs` | Additional raw anvil CLI arguments. A `--host` here is refused unless `allowNonLoopbackHost` is set — pass the bind address via `host`. |
| `timeoutMs` | Startup timeout. |
| `silent` | Suppress or stream Anvil logs. |
| `allowNonLoopbackHost` | Explicit opt-in for a non-loopback `host`. Without it, `start()` refuses to bind beyond loopback — Anvil's admin RPC is unauthenticated. |

`start()` only reports ready once the spawned process itself is listening and
reports the requested chain id — a pre-existing node on the same port fails
loudly instead of being silently adopted.

## PrivateKeyRpcClient

`PrivateKeyRpcClient` is for live-chain QA only.

```ts
const client = new PrivateKeyRpcClient({
  privateKey: process.env.WEB3_TESTER_PRIVATE_KEY as `0x${string}`,
  rpcUrl: process.env.WEB3_TESTER_RPC_URL,
});
```

Two guards keep a misconfigured client from signing where it should not:

- Construction throws for chains that are neither marked `testnet: true` nor
  local dev chains (31337/1337), unless `allowMainnet: true` is passed — the
  testnet guarantee is a property of the client, not of any fixture wiring.
  (`createLiveFixtures({ allowMainnet })` passes the flag through.)
- Before the first broadcast (`eth_sendTransaction` or
  `eth_sendRawTransaction`), the client verifies the RPC endpoint's
  `eth_chainId` matches the configured chain and fails loudly on mismatch.
  Verification is cached after the first success.
- `eth_sendTransaction` only signs when `from` is omitted or matches the
  client's account. RPC-shaped typed transaction fields are preserved:
  `type` (`0x0`-`0x4` or viem names), `accessList`, blob fee/hash fields, and
  `authorizationList` are parsed before the transaction is signed.

It supports:

- `personal_sign` (hex payloads are signed as raw bytes; both `[message, address]` and legacy `[address, message]` param orders)
- `eth_sign`
- `eth_signTypedData_v3` / `eth_signTypedData_v4`
- `eth_sendTransaction` (`from`-checked; typed transaction fields preserved)
- `eth_sendRawTransaction` (chain-verified like `eth_sendTransaction`)
- read-only RPC forwarding through Viem public client

It records sent transaction hashes in:

- `sentTransactions`
- `sentTransactionRequests`
