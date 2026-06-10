# Web3 Tester

`@marigoldlabs/web3-tester` is a Playwright, Anvil, Viem, and MetaMask harness for Web3 end-to-end tests.

The injected fixtures test dApp behavior with a programmable EIP-1193 provider. The real-wallet adapter launches a persistent Chromium profile with MetaMask, imports or unlocks the profile when configured, and exposes wallet-side actions so consumer apps do not carry extension automation code.

## What It Provides

- Playwright fixtures that start one Anvil node per worker for parallel-safe local EVM tests.
- Automatic `evm_snapshot` and `evm_revert` around every wallet test.
- A programmable `MockWalletController` for approval, rejection, pending-approval holds, disconnects, account changes, and network-change events, with transaction recording (`sentTransactions`, `waitForNextTransaction`).
- EIP-6963 provider announcements (one distinct provider object per wallet) for wallet selector testing.
- Viem-backed chain helpers for impersonation, balance setup, time travel, and block mining.
- Optional live-chain fixtures for controlled testnet QA with a runtime-only private key (`createLiveFixtures` for custom chains/env names).
- Real MetaMask mode: pinned-version extension download (`prepareMetaMaskExtension`), one-time onboarding into a cached profile with disposable per-test clones (`buildWalletProfile`/`cloneWalletProfile`), Playwright fixtures (`@marigoldlabs/web3-tester/real-wallet-fixtures`), wallet-side network add/switch, dapp connection, signature/transaction confirmation and rejection, and token approval helpers — validated end to end by an opt-in smoke suite against the pinned MetaMask build.
- Fjord v4 QA specs (separate `fjord` Playwright project) documenting the current state of `https://v4.fjordfoundry.com`.

## Install In A Consumer App

From the Fjord v4 package, install this repo as a dev dependency:

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
  await page.getByRole('button', { name: /connect/i }).click();
  await expect(page.getByText(wallet.primaryAccount.slice(0, 6))).toBeVisible();
});
```

For fully in-UI real wallet tests, use the real-wallet fixtures. The pinned
MetaMask build is downloaded automatically, onboarding runs once into a
cached profile, and every test gets a disposable clone of that profile:

```ts
import { expect, test } from '@marigoldlabs/web3-tester/real-wallet-fixtures';

test.use({
  realWalletOptions: {
    setup: { seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE },
    baseURL: 'https://app.example.com',
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
});

await wallet.connectToDapp();
await wallet.confirmSignature();
await wallet.confirmTransaction();
await wallet.close();
```

MetaMask version pinning: selectors are maintained against
`DEFAULT_METAMASK_VERSION` (currently 12.23.1) and validated by the opt-in
smoke suite (`WEB3_TESTER_REAL_WALLET_SMOKE=true npm test`). Override with
`WEB3_TESTER_METAMASK_VERSION` at your own risk. MetaMask 13.x cannot be used
for fresh-profile onboarding (its social-login onboarding does not complete
under automation); it works with a preconfigured persistent profile.

## Local Development

```bash
npm install
npx playwright install chromium
npm run typecheck
npm run build
npm test          # hermetic library tests (needs anvil)
npm run test:fjord  # opt-in Fjord v4 QA suite (needs DAPP_URL access + env gates)
WEB3_TESTER_REAL_WALLET_SMOKE=true npm test  # opt-in real-MetaMask smoke suite
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
| `ANVIL_HOST` | `127.0.0.1` | Host for worker Anvil RPC endpoints. |
| `ANVIL_PORT` | `8645` | Base port (worker index is added for isolation). Defaults off 8545 so a developer-run dev node never collides. |
| `ANVIL_CHAIN_ID` | `31337` | Chain ID exposed by local Anvil and the injected provider. |
| `ANVIL_FORK_URL` | unset | Optional fork RPC URL. |
| `ANVIL_SILENT` | `true` | Set to `false` to stream Anvil logs. |
| `WEB3_TESTER_PRIVATE_KEY` | unset | Runtime-only private key for live-chain fixtures (`FJORD_PRIVATE_KEY` still honored as a legacy alias). |
| `WEB3_TESTER_RPC_URL` | Viem default | Optional RPC URL for live fixtures (`SEPOLIA_RPC_URL` legacy alias). |
| `WEB3_TESTER_METAMASK_VERSION` | pinned default | MetaMask release downloaded by `prepareMetaMaskExtension`. |
| `WEB3_TESTER_REAL_WALLET_EXTENSION_PATH` | auto-download | Path to an unpacked MetaMask extension (skips the download). |
| `WEB3_TESTER_REAL_WALLET_PROFILE_DIR` | profile cache | Explicit persistent Chromium user-data directory, or a Chrome profile directory such as `Profile 1`. Disables the per-test profile cache. |
| `WEB3_TESTER_REAL_WALLET_PASSWORD` | deterministic test password | MetaMask password used to unlock profiles. |
| `WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE` | unset | Seed phrase used to build the cached real-wallet profile. |
| `WEB3_TESTER_REAL_WALLET_SMOKE` | unset | Set `true` to run the real-MetaMask smoke suite. |
| `DAPP_URL` | `https://v4.fjordfoundry.com` | Base URL for the Fjord QA project. |
| `FJORD_*` gates | unset | Fjord QA mutation gates — see `docs/FJORD_LIVE_QA.md`. |

## Package Surface

The installable package exports:

- `@marigoldlabs/web3-tester`
- `@marigoldlabs/web3-tester/fixtures`
- `@marigoldlabs/web3-tester/live-fixtures`
- `@marigoldlabs/web3-tester/real-wallet`
- `@marigoldlabs/web3-tester/real-wallet-fixtures`
- `@marigoldlabs/web3-tester/metamask-extension`
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
```

## Wallet Control

```ts
await wallet.simulateRejection('eth_sendTransaction');
await wallet.disconnect();
await wallet.reconnect();
await wallet.setAccounts(['0x0000000000000000000000000000000000000001']);
await wallet.switchNetwork(11155111);

// Pending-approval simulation and transaction assertions:
const held = wallet.holdNextRequest('personal_sign');
// ... trigger the dapp action, assert the pending UI ...
(await held).reject('User changed their mind.');

const txPromise = wallet.waitForNextTransaction();
// ... trigger the dapp action ...
const hash = await txPromise;
```

Dapp-initiated `wallet_switchEthereumChain` follows MetaMask semantics: it
throws 4902 for chains the wallet does not know; chains become known via
`wallet_addEthereumChain` or a test-driven `wallet.switchNetwork(...)`.

## Multiple Wallet Selectors

```ts
test.use({
  walletOptions: {
    providerInfo: { name: 'Mock MetaMask', rdns: 'io.metamask' },
    additionalProviders: [
      { name: 'Mock Rabby', rdns: 'io.rabby' },
      { name: 'Mock Rainbow', rdns: 'me.rainbow' },
    ],
  },
});
```

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/` | Reusable package source. |
| `tests/` (library project) | Hermetic harness self-tests: `anvil`, `mock-wallet`, `private-key-rpc-client`, `provider-injection`, `real-wallet`, `real-wallet-smoke` (opt-in). |
| `tests/fjord*.spec.ts` (fjord project) | Fjord v4 public, live, and mutation QA specs (`npm run test:fjord`). |
| `docs/` | Dependency, API, architecture, and Fjord QA documentation. |
| `examples/` | Copyable consumer-app snippets. |
| `reports/` | Fjord v4 QA reports and library review reports. |

## Safety Model

- Local tests use deterministic Anvil accounts only.
- Live tests require explicit environment variables and never store private keys in source.
- Real-wallet tests use a persistent browser profile and keep extension-side automation inside this package.
- Mutation tests are skipped unless their opt-in flag is set.
- Published reports redact secrets and record transaction hashes only when useful for auditability.

## More Documentation

- [docs/API.md](docs/API.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/CONSUMING_FROM_FJORD.md](docs/CONSUMING_FROM_FJORD.md)
- [docs/FJORD_LIVE_QA.md](docs/FJORD_LIVE_QA.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
