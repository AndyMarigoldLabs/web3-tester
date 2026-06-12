# Consuming Web3 Tester From Fjord V4

This guide covers adding the published package to Fjord v4 as a dependency.

## Install

```bash
npm install --save-dev @marigoldlabs/web3-tester
```

For a pinned dependency, use an exact package version:

```bash
npm install --save-dev @marigoldlabs/web3-tester@<version>
```

## Playwright Config

Use Fjord's existing Playwright config if it already exists. The important parts are:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
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

The injected local fixtures and live-key fixtures follow the current
Playwright browser project, so this matrix exercises Chromium, Firefox, and
WebKit. Put any `@marigoldlabs/web3-tester/real-wallet-fixtures` tests in a
separate Chromium-only project; real Chrome extensions cannot run in Firefox
or WebKit.

## Local Deterministic Tests

```ts
import { expect, test } from '@marigoldlabs/web3-tester/fixtures';

test('connects through the injected provider', async ({ page, wallet }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.getByText('Mock Wallet').click();

  await expect(page.getByText(wallet.primaryAccount.slice(0, 6))).toBeVisible();
});
```

## Test Options

Customize provider identity for wallet selector coverage:

```ts
test.use({
  walletOptions: {
    providerInfo: { name: 'MetaMask', rdns: 'io.metamask' },
    additionalProviders: [
      { name: 'Rabby', rdns: 'io.rabby' },
      { name: 'Rainbow', rdns: 'me.rainbow' },
    ],
  },
});
```

Customize Anvil:

```ts
test.use({
  anvilOptions: {
    runtime: 'docker',
    chainId: 31337,
    forkUrl: process.env.ANVIL_FORK_URL,
  },
});
```

## Live Sepolia Tests

```ts
import { expect, test } from '@marigoldlabs/web3-tester/live-fixtures';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required.');

test('loads the Sepolia account', async ({ page, wallet }) => {
  await page.goto('/');
  await expect(page.getByText(wallet.primaryAccount.slice(0, 6))).toBeVisible();
});
```

As of 0.2.x live wallets are deny-by-default: `eth_requestAccounts`,
`personal_sign`, `eth_sendTransaction`, `eth_sendRawTransaction`, and
`wallet_*` prompts throw `4001` until armed via `wallet.approveNext(method)`
(or `test.use({ liveOptions: { walletOptions: { autoApprove: true } } })` as
a deliberate opt-in). And when the Playwright config sets a `baseURL` — as
the example above does — the injected provider only exists on that origin;
override with `walletOptions.allowedOrigins` if a journey legitimately
crosses origins.

Run with:

```powershell
$env:FJORD_PRIVATE_KEY = '<runtime-only-key>'
$env:SEPOLIA_RPC_URL = '<optional-rpc-url>'
npm test
```

## Mutation Gates

Use explicit flags for anything that spends funds or mutates backend state:

```powershell
$env:FJORD_RUN_TRANSACTIONS = 'true'
$env:FJORD_MUTATE_STATE = 'true'
$env:FJORD_PUBLISH_SALES = 'true'
$env:FJORD_ADMIN_MUTATE = 'true'
```

Keep destructive or expensive tests behind separate flags so normal CI remains read-only.

## CI Recommendations

- Run deterministic Anvil tests on every PR.
- Run live Sepolia read-only tests on a scheduled job or protected branch.
- Run live mutation tests manually with approval.
- Store `FJORD_PRIVATE_KEY` and `SEPOLIA_RPC_URL` only as CI secrets.
- Pin the npm dependency to an exact version once Fjord depends on it.
