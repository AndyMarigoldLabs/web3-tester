import path from 'node:path';
import { test as base, type Page } from '@playwright/test';
import { prepareMetaMaskExtension } from './metamask-extension.js';
import { buildWalletProfile, cloneWalletProfile } from './real-wallet-cache.js';
import {
  launchRealWallet,
  type RealWalletSession,
  type RealWalletSetup,
} from './real-wallet.js';

export type RealWalletFixtureOptions = {
  /** Wallet setup. Defaults to WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE / _PASSWORD. */
  setup?: RealWalletSetup;
  /**
   * Unpacked MetaMask directory. Defaults to
   * WEB3_TESTER_REAL_WALLET_EXTENSION_PATH, or downloads the pinned release.
   */
  extensionPath?: string;
  /** MetaMask version to download when extensionPath is not given. */
  metamaskVersion?: string;
  /**
   * Explicit persistent profile directory. Disables the profile cache; the
   * test reuses (and mutates) this profile directly, so parallel tests must
   * not share it.
   */
  profileDir?: string;
  baseURL?: string;
  expectedAddress?: string;
  headless?: boolean;
};

export type RealWalletFixtures = {
  realWalletOptions: RealWalletFixtureOptions;
  realWallet: RealWalletSession;
};

const setupFromEnv = (): RealWalletSetup => ({
  password: process.env.WEB3_TESTER_REAL_WALLET_PASSWORD || undefined,
  seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE || undefined,
});

/**
 * Playwright fixtures for real-MetaMask tests. Each test gets a disposable
 * clone of a cached, pre-onboarded profile (built once per seed phrase +
 * extension version), so tests are isolated, parallel-safe, and skip
 * onboarding cost after the first run. `context` and `page` are rebound to
 * the persistent extension context.
 */
export const test = base.extend<RealWalletFixtures>({
  realWalletOptions: [
    async ({}, use) => {
      await use({});
    },
    { option: true },
  ],

  realWallet: async ({ realWalletOptions }, use, testInfo) => {
    const options = realWalletOptions;
    const setup = options.setup ?? setupFromEnv();
    const extensionPath =
      options.extensionPath ??
      process.env.WEB3_TESTER_REAL_WALLET_EXTENSION_PATH ??
      (await prepareMetaMaskExtension({ version: options.metamaskVersion }));

    let profileDir =
      options.profileDir ?? process.env.WEB3_TESTER_REAL_WALLET_PROFILE_DIR;

    if (!profileDir) {
      if (!setup.seedPhrase) {
        throw new Error(
          'Real-wallet fixtures need a seed phrase (realWalletOptions.setup.seedPhrase or ' +
            'WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE) to build a cached profile, ' +
            'or an explicit profileDir pointing at a prepared MetaMask profile.',
        );
      }

      const cachedProfile = await buildWalletProfile({
        extensionPath,
        setup,
        headless: options.headless,
      });
      profileDir = await cloneWalletProfile(
        cachedProfile,
        path.join(testInfo.outputDir, 'metamask-profile'),
      );
    }

    const session = await launchRealWallet({
      baseURL: options.baseURL,
      expectedAddress: options.expectedAddress,
      extensionPath,
      headless: options.headless,
      profileDir,
      setup,
    });

    try {
      await use(session);
    } finally {
      await session.close().catch(() => undefined);
    }
  },

  context: async ({ realWallet }, use) => {
    await use(realWallet.context);
  },

  page: async ({ context }, use) => {
    const page: Page = await context.newPage();
    await use(page);
    await page.close().catch(() => undefined);
  },
});

export { expect } from '@playwright/test';
