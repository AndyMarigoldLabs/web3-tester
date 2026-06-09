# API Reference

This package exposes two Playwright fixture families and one real-wallet adapter:

- `fixtures`: local deterministic Anvil tests.
- `live-fixtures`: live Sepolia tests that sign with a runtime-only private key.
- `real-wallet`: persistent Chromium and MetaMask automation for fully in-UI Web3 tests.

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

Required environment:

```bash
FJORD_PRIVATE_KEY=<runtime-only-private-key>
```

Optional:

```bash
SEPOLIA_RPC_URL=https://...
```

## Real Wallet

```ts
import { launchRealWallet } from '@marigoldlabs/web3-tester/real-wallet';

const session = await launchRealWallet({
  extensionPath: process.env.FJORD_REAL_WALLET_EXTENSION_PATH as string,
  profileDir: process.env.FJORD_REAL_WALLET_PROFILE_DIR as string,
  expectedAddress: process.env.FJORD_REAL_WALLET_ADDRESS,
  setup: process.env.FJORD_REAL_WALLET_PASSWORD
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
| `headless` | Chromium headless setting. Defaults to `false` because extensions require headed Chromium in normal use. |
| `setup.password` | Password used to unlock MetaMask, or to import a seed phrase when onboarding is visible. |
| `setup.seedPhrase` | Seed phrase used only if MetaMask opens on onboarding. |
| `slowMo` | Optional Playwright slow-motion delay. |

Returned session methods:

| Method | Description |
| --- | --- |
| `connectToDapp(accounts?)` | Approves a dapp connection request in MetaMask. |
| `confirmSignature()` | Confirms a pending signature request. |
| `confirmTransaction(options?)` | Confirms a pending transaction request. |
| `approveTokenPermission(options?)` | Approves a pending ERC-20 spending permission request. |
| `rejectSignature()` | Rejects a pending signature request. |
| `rejectTransaction()` | Rejects a pending transaction request. |
| `getAccountAddress()` | Returns the selected MetaMask account. |
| `close()` | Closes the persistent browser context. |

## MockWalletController

```ts
const wallet = new MockWalletController(page, rpcClient, {
  accounts: ['0x...'],
  chainId: 31337,
  autoApprove: true,
  connected: true,
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
| `injectMockProvider()` | Adds the RPC bridge and injects `window.ethereum`. |
| `autoApprove(enabled)` | Toggles automatic approval for future signing methods. |
| `simulateRejection(methods?, message?)` | Rejects the next matching request with code `4001`. |
| `setAccounts(accounts)` | Updates accounts and emits `accountsChanged`. |
| `disconnect()` | Emits `accountsChanged` and `disconnect`. |
| `reconnect()` | Emits `connect` and `accountsChanged`. |
| `switchNetwork(chainId)` | Updates chain ID and emits `chainChanged`. |

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
- `personal_sign`
- `eth_sign`
- `eth_signTypedData`
- `eth_signTypedData_v3`
- `eth_signTypedData_v4`

Unhandled methods are forwarded to the configured RPC client.

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
| `timeoutMs` | Startup timeout. |
| `silent` | Suppress or stream Anvil logs. |

## PrivateKeyRpcClient

`PrivateKeyRpcClient` is for live-chain QA only.

```ts
const client = new PrivateKeyRpcClient({
  privateKey: process.env.FJORD_PRIVATE_KEY as `0x${string}`,
  rpcUrl: process.env.SEPOLIA_RPC_URL,
});
```

It supports:

- `personal_sign`
- `eth_sign`
- `eth_signTypedData_v4`
- `eth_sendTransaction`
- read-only RPC forwarding through Viem public client

It records sent transaction hashes in:

- `sentTransactions`
- `sentTransactionRequests`
