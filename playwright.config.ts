import { defineConfig, devices } from '@playwright/test';

const hermeticLibraryTests = [
  '**/anvil.spec.ts',
  '**/benchmark.spec.ts',
  '**/eip5792.spec.ts',
  '**/eip7702.spec.ts',
  '**/erc20.spec.ts',
  '**/fixtures-multichain.spec.ts',
  '**/live-fixtures.spec.ts',
  '**/matchers.spec.ts',
  '**/mock-wallet.spec.ts',
  '**/mock-wallet-multichain.spec.ts',
  '**/multi-user.spec.ts',
  '**/private-key-rpc-client.spec.ts',
  '**/provider-injection.spec.ts',
  '**/real-wallet.spec.ts',
  '**/real-wallet-smoke.spec.ts',
  '**/safe.spec.ts',
  '**/walletconnect.spec.ts',
  '**/walletconnect-live.spec.ts',
];

const browserPortableTests = [
  '**/live-fixtures.spec.ts',
  '**/multi-user.spec.ts',
  '**/provider-injection.spec.ts',
];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : [['list']],
  projects: [
    // Hermetic library tests: no external services beyond a local anvil.
    // This is what `npm test` runs and what CI gates on.
    {
      name: 'library',
      testMatch: hermeticLibraryTests,
      use: {
        ...devices['Desktop Chrome'],
        trace: 'on-first-retry',
      },
    },
    // Browser-portable fixture coverage. Real extension fixtures are
    // intentionally absent here because Chrome extensions require Chromium.
    {
      name: 'browser-chromium',
      testMatch: browserPortableTests,
      use: {
        ...devices['Desktop Chrome'],
        trace: 'on-first-retry',
      },
    },
    {
      name: 'browser-firefox',
      testMatch: browserPortableTests,
      use: {
        ...devices['Desktop Firefox'],
        trace: 'on-first-retry',
      },
    },
    {
      name: 'browser-webkit',
      testMatch: browserPortableTests,
      use: {
        ...devices['Desktop Safari'],
        trace: 'on-first-retry',
      },
    },
    // Fjord v4 application QA against a live deployment. Opt-in via
    // `npm run test:fjord`; requires DAPP_URL/env gates documented in
    // docs/FJORD_LIVE_QA.md. Traces are opt-in because live runs authenticate
    // with a real wallet session that traces would capture.
    {
      name: 'fjord',
      testMatch: '**/fjord*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.DAPP_URL ?? 'https://v4.fjordfoundry.com',
        trace: process.env.FJORD_TRACE === 'true' ? 'on-first-retry' : 'off',
      },
    },
  ],
});
