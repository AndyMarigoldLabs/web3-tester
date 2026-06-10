# API Reference

This package exposes three Playwright fixture families and a real-wallet adapter:

- `fixtures`: local deterministic Anvil tests.
- `live-fixtures`: live testnet tests that sign with a runtime-only private key.
- `real-wallet-fixtures`: real-MetaMask tests with automatic extension download and per-test cached profiles.
- `real-wallet`: the imperative MetaMask adapter underneath the fixtures.
- `metamask-extension`: pinned MetaMask download/cache helpers.

Fixtures are lazy: the mock provider is only injected when a test references the `wallet` fixture.

## Local Fixtures

```ts
import { expect, test } from '@marigoldlabs/web3-tester/fixtures';
```

Fixtures:

| Fixture | Scope | Description |
| --- | --- | --- |
| `wallet` | test | `MockWalletController` injected into the page before app scripts run. |
| `chain` | worker | `ChainController` connected to the worker's Anvil node. |
| `anvil` | worker | Running `AnvilInstance`. |
| `walletOptions` | option | Per-test overrides for wallet identity and behavior. |
| `anvilOptions` | option | Worker-level Anvil runtime overrides. |

Each `wallet` test snapshots chain state before test code runs and reverts after the test finishes.

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

## Real Wallet Fixtures

```ts
import { expect, test } from '@marigoldlabs/web3-tester/real-wallet-fixtures';

test.use({
  realWalletOptions: {
    setup: { seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE },
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
| `realWalletOptions` | option | Setup, extension path/version, baseURL, expectedAddress, headless, explicit profileDir. |
| `context`, `page` | test | Rebound to the persistent extension context. |

Without an explicit `profileDir`, the fixture downloads the pinned MetaMask
build (`prepareMetaMaskExtension`), walks onboarding once into a cache keyed
by (seed phrase, password, extension version), verifies the imported account
against the seed-derived address, and gives every test its own copy of that
profile — parallel-safe and onboarding-free after the first run.

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

`buildWalletProfile({ extensionPath, setup })` and
`cloneWalletProfile(cachedDir, targetDir)` (exported from the root entry)
manage the onboarded-profile cache directly for custom setups.

Both current MetaMask 13.x ("multichain" UI) and the older 12.x UI are
supported and validated by the smoke suite. `getAccountAddress()` without an
`expectedAddress` returns a valid address on both, but 13.x's multichain
account tree has no single "selected" account before a dapp connects, so on
13.x prefer passing `expectedAddress` (verified against the wallet UI) or read
the connected account from your dapp.

## Real Wallet (imperative)

```ts
import { launchRealWallet } from '@marigoldlabs/web3-tester/real-wallet';

const session = await launchRealWallet({
  extensionPath: process.env.FJORD_REAL_WALLET_EXTENSION_PATH as string,
  profileDir: process.env.FJORD_REAL_WALLET_PROFILE_DIR as string,
  expectedAddress: process.env.FJORD_REAL_WALLET_ADDRESS,
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
| `headless` | Runs Chromium with `--headless=new` (extensions cannot load in Playwright's default headless shell). Defaults to `false`. |
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
| `getAccountAddress()` | Returns the selected MetaMask account (full address; read via the header copy button). |
| `close()` | Closes the persistent browser context. |

Confirmation flows open `chrome-extension://<id>/notification.html` on demand
when MetaMask suppresses its popup (it does so whenever extension tabs are
open), so they work regardless of window management.

## MockWalletController

```ts
const wallet = new MockWalletController(page, rpcClient, {
  accounts: ['0x...'],
  chainId: 31337,
  autoApprove: true,
  connected: true,
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

Methods:

| Method | Description |
| --- | --- |
| `injectMockProvider()` | Adds the RPC bridge and injects `window.ethereum` context-wide (popups and dapp-opened tabs included). One controller per browser context. |
| `autoApprove(enabled)` | Toggles automatic approval for signing methods, `eth_requestAccounts`, and `wallet_*` prompt methods. |
| `approveNext(methods?, match?)` | Arms approval for the next matching request while autoApprove is off — the explicit per-call grant for real-key wallets. `match(method, params)` binds the grant to an expected payload. Queued rejections and holds take precedence; grants do not expire until consumed. |
| `simulateRejection(methods?, message?)` | Rejects the next matching request with code `4001`. The default method set covers all approval-gated methods. |
| `holdNextRequest(methods?)` | Keeps the next matching request pending until the returned `HeldRequest` is approved or rejected — for "confirm in your wallet" UI states. |
| `waitForNextTransaction(options?)` | Resolves with the hash of the next transaction the page submits. |
| `setAccounts(accounts)` | Updates accounts and emits `accountsChanged`. |
| `disconnect()` | Emits `accountsChanged` and `disconnect`; signing while disconnected throws `4100`. |
| `reconnect()` | Emits `connect` and `accountsChanged`. |
| `switchNetwork(chainId)` | Updates chain ID, marks it known, and emits `chainChanged`. |

Transaction recording: `sentTransactions: Hex[]` and
`sentTransactionRequests: SentTransactionRecord[]`.

Chain semantics follow MetaMask: dapp-initiated `wallet_switchEthereumChain`
throws `4902` for unknown chains; `wallet_addEthereumChain` validates,
registers, and switches; `wallet_revokePermissions` disconnects. Unknown
`wallet_*` methods return `4200` instead of leaking node errors; all other
unhandled methods are forwarded to the configured RPC client.

Supported wallet methods include:

- `eth_accounts`
- `eth_requestAccounts`
- `eth_chainId`
- `net_version`
- `wallet_getPermissions`
- `wallet_requestPermissions`
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
- `wallet_revokePermissions`

`eth_signTypedData` (legacy v1) returns `4200`.

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

It supports:

- `personal_sign` (hex payloads are signed as raw bytes; both `[message, address]` and legacy `[address, message]` param orders)
- `eth_sign`
- `eth_signTypedData_v3` / `eth_signTypedData_v4`
- `eth_sendTransaction`
- `eth_sendRawTransaction` (chain-verified like `eth_sendTransaction`)
- read-only RPC forwarding through Viem public client

It records sent transaction hashes in:

- `sentTransactions`
- `sentTransactionRequests`
