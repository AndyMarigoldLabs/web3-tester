# Consuming Web3 Tester From Fjord V4

This guide covers adding this repo to Fjord v4 as a dependency.

## Install

```bash
npm install --save-dev github:AndyMarigoldLabs/web3-tester
```

For a pinned dependency, use a commit SHA:

```bash
npm install --save-dev github:AndyMarigoldLabs/web3-tester#<commit-sha>
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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

## Local Deterministic Tests

```ts
import { expect, test } from '@andy-marigold-labs/web3-tester/fixtures';

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
import { expect, test } from '@andy-marigold-labs/web3-tester/live-fixtures';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required.');

test('loads the Sepolia account', async ({ page, wallet }) => {
  await page.goto('/');
  await expect(page.getByText(wallet.primaryAccount.slice(0, 6))).toBeVisible();
});
```

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
- Pin this repo by commit SHA once Fjord depends on it.
