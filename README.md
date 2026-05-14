# Web3 Tester

`@andy-marigold-labs/web3-tester` is a Playwright, Anvil, and Viem harness for deterministic Web3 end-to-end tests without a browser wallet extension.

The core rule is simple: test the dApp, not MetaMask's popup UI. The harness injects a standards-shaped EIP-1193 provider before application scripts run, bridges wallet RPC calls back to the Playwright process, and sends chain operations directly to Anvil or to an explicit live-chain signer.

## What It Provides

- Playwright fixtures that start one Anvil node per worker for parallel-safe local EVM tests.
- Automatic `evm_snapshot` and `evm_revert` around every wallet test.
- A programmable `MockWalletController` for approval, rejection, disconnects, account changes, and network-change events.
- EIP-6963 provider announcements for wallet selector testing.
- Viem-backed chain helpers for impersonation, balance setup, time travel, and block mining.
- Optional live-chain fixtures for controlled Sepolia QA with a runtime-only private key.
- Fjord v4 QA specs and reports that document the current state of `https://v4.fjordfoundry.com`.

## Install In A Consumer App

From the Fjord v4 package, install this repo as a dev dependency:

```bash
npm install --save-dev github:AndyMarigoldLabs/web3-tester
```

Then import the local deterministic fixture:

```ts
import { expect, test } from '@andy-marigold-labs/web3-tester/fixtures';

test('user can submit a wallet transaction', async ({ page, wallet }) => {
  await page.goto('/swap');

  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.getByText('Mock Wallet').click();

  await page.getByRole('button', { name: /swap/i }).click();
  await expect(page.getByText(/success/i)).toBeVisible();

  expect(wallet.primaryAccount).toMatch(/^0x/);
});
```

For live Sepolia tests, import the live fixture instead:

```ts
import { expect, test } from '@andy-marigold-labs/web3-tester/live-fixtures';

test('signs in through SIWE on Sepolia', async ({ page, wallet }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /connect/i }).click();
  await expect(page.getByText(wallet.primaryAccount.slice(0, 6))).toBeVisible();
});
```

## Local Development

```bash
npm install
npx playwright install chromium
npm run typecheck
npm run build
npm test
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
| `DAPP_URL` | `https://v4.fjordfoundry.com` | Playwright base URL for app tests. |
| `ANVIL_EXECUTABLE` | `anvil` | Path to the Anvil binary. |
| `ANVIL_RUNTIME` | `binary` | Set to `docker` to run Anvil through Docker Desktop. |
| `ANVIL_DOCKER_IMAGE` | `ghcr.io/foundry-rs/foundry:latest` | Docker image used when `ANVIL_RUNTIME=docker`. |
| `ANVIL_HOST` | `127.0.0.1` | Host for worker Anvil RPC endpoints. |
| `ANVIL_PORT` | `8545` | Base port. Playwright worker index is added for isolation. |
| `ANVIL_CHAIN_ID` | `31337` | Chain ID exposed by local Anvil and the injected provider. |
| `ANVIL_FORK_URL` | unset | Optional fork RPC URL. |
| `ANVIL_SILENT` | `true` | Set to `false` to stream Anvil logs. |
| `FJORD_PRIVATE_KEY` | unset | Runtime-only private key for live Sepolia QA. |
| `SEPOLIA_RPC_URL` | Viem default | Optional Sepolia RPC URL for live tests. |
| `FJORD_RUN_TRANSACTIONS` | unset | Must be `true` to run live transaction-spending tests. |
| `FJORD_MUTATE_STATE` | unset | Must be `true` to deploy QA tokens or create sale drafts. |
| `FJORD_PUBLISH_SALES` | unset | Must be `true` to attempt live sale publishing. |
| `FJORD_ADMIN_MUTATE` | unset | Must be `true` to attempt admin mutation tests. |

## Package Surface

The installable package exports:

- `@andy-marigold-labs/web3-tester`
- `@andy-marigold-labs/web3-tester/fixtures`
- `@andy-marigold-labs/web3-tester/live-fixtures`
- `@andy-marigold-labs/web3-tester/anvil`
- `@andy-marigold-labs/web3-tester/mock-wallet-controller`
- `@andy-marigold-labs/web3-tester/private-key-rpc-client`

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
```

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
| `tests/provider-injection.spec.ts` | Harness self-tests. |
| `tests/fjord*.spec.ts` | Fjord v4 public, live, and mutation QA specs. |
| `docs/` | Dependency, API, architecture, and Fjord QA documentation. |
| `examples/` | Copyable consumer-app snippets. |
| `reports/` | Current Fjord v4 QA reports. |

## Safety Model

- Local tests use deterministic Anvil accounts only.
- Live tests require explicit environment variables and never store private keys in source.
- Mutation tests are skipped unless their opt-in flag is set.
- Published reports redact secrets and record transaction hashes only when useful for auditability.

## More Documentation

- [docs/API.md](docs/API.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/CONSUMING_FROM_FJORD.md](docs/CONSUMING_FROM_FJORD.md)
- [docs/FJORD_LIVE_QA.md](docs/FJORD_LIVE_QA.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
