import path from 'node:path';
import { test as base, type Page } from '@playwright/test';
import { prepareMetaMaskExtension } from './metamask-extension.js';
import {
  buildWalletProfile,
  cloneWalletProfile,
  type BuildWalletProfileOptions,
} from './real-wallet-cache.js';
import { benchmarkForTest, benchmarkObjectMethods } from './benchmark.js';
import {
  launchRealWallet,
  type RealWalletSession,
  type RealWalletSetup,
  type WalletGeneration,
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
  /**
   * MetaMask UI generation to drive ('12x' | '13x'). Defaults to the major
   * version in the extension's manifest; set explicitly for custom builds.
   */
  generation?: WalletGeneration;
  /**
   * Run the browser headless. No default — choose explicitly here or via
   * WEB3_TESTER_REAL_WALLET_HEADLESS=true|false. Headed is the fully
   * validated mode.
   */
  headless?: boolean;
  /**
   * One-time profile customization baked into the cached profile (import
   * keys, add accounts/networks/tokens) — Synpress defineWalletSetup-style.
   * Ignored when an explicit profileDir bypasses the cache.
   */
  profileSetup?: BuildWalletProfileOptions['customize'];
};

export type RealWalletFixtures = {
  realWalletOptions: RealWalletFixtureOptions;
  realWallet: RealWalletSession;
};

const setupFromEnv = (): RealWalletSetup => ({
  password: process.env.WEB3_TESTER_REAL_WALLET_PASSWORD || undefined,
  seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE || undefined,
});

const assertChromiumProject = (browserName: string): void => {
  if (browserName !== 'chromium') {
    throw new Error(
      '@marigoldlabs/web3-tester/real-wallet-fixtures launch a Chromium extension context. ' +
        `The current Playwright project uses "${browserName}". Exclude real-wallet tests from non-Chromium ` +
        'projects, or run them in a dedicated Chromium project.',
    );
  }
};

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

  realWallet: async ({ realWalletOptions, browserName }, use, testInfo) => {
    assertChromiumProject(browserName);

    const benchmark = benchmarkForTest(testInfo, { suite: 'real-wallet' });
    let session: RealWalletSession | undefined;

    try {
      const options = realWalletOptions;
      const setup = options.setup ?? setupFromEnv();
      const extensionPath =
        options.extensionPath ??
        process.env.WEB3_TESTER_REAL_WALLET_EXTENSION_PATH ??
        (await benchmark.measure('realWallet.prepareMetaMaskExtension', () =>
          prepareMetaMaskExtension({ version: options.metamaskVersion }),
        ));

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

        const cachedProfile = await benchmark.measure('realWallet.buildWalletProfile', () =>
          buildWalletProfile({
            extensionPath,
            setup,
            headless: options.headless,
            generation: options.generation,
            customize: options.profileSetup,
          }),
        );
        profileDir = await benchmark.measure('realWallet.cloneWalletProfile', () =>
          cloneWalletProfile(
            cachedProfile,
            path.join(testInfo.outputDir, 'metamask-profile'),
          ),
        );
      }

      session = await benchmark.measure('realWallet.launchRealWallet', () =>
        launchRealWallet({
          baseURL: options.baseURL,
          expectedAddress: options.expectedAddress,
          extensionPath,
          generation: options.generation,
          headless: options.headless,
          profileDir,
          setup,
        }),
      );

      await use(benchmarkObjectMethods(session, benchmark, { prefix: 'realWallet', exclude: ['close'] }));
    } finally {
      if (session) {
        const activeSession = session;
        await benchmark.measure('realWallet.close', () => activeSession.close().catch(() => undefined));
      }
      await benchmark.flush();
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

// The web3-extended expect: every matcher from ./matchers.js, zero migration.
export { expect } from './matchers.js';
