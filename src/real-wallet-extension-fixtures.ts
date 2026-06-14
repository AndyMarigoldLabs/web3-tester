import path from 'node:path';
import { test as base, type Page } from '@playwright/test';
import {
  buildWalletExtensionProfile,
  cloneWalletProfile,
  type BuildWalletExtensionProfileOptions,
} from './real-wallet-cache.js';
import { benchmarkForTest, benchmarkObjectMethods } from './benchmark.js';
import {
  launchRealWalletExtension,
  type RealWalletExtensionLaunchOptions,
  type RealWalletExtensionSession,
} from './real-wallet-extension.js';

export type RealWalletExtensionFixtureOptions = Omit<
  RealWalletExtensionLaunchOptions,
  'extensionPath' | 'profileDir'
> & {
  /** Unpacked Chromium extension directory. Defaults to WEB3_TESTER_REAL_WALLET_EXTENSION_PATH. */
  extensionPath?: string;
  /**
   * Explicit persistent profile directory. Disables the profile cache; the
   * test reuses (and mutates) this profile directly, so parallel tests must
   * not share it.
   */
  profileDir?: string;
  /** Cache identity for non-MetaMask setup. Required when profileDir is absent. */
  profileCacheKey?: string;
  /** Directory cached profiles live in. Defaults to ~/.cache/web3-tester/profiles. */
  cacheDir?: string;
  /** Rebuild the cached profile even if it already exists. */
  forceProfile?: boolean;
  /** One-time extension setup baked into the cached profile. */
  profileSetup?: BuildWalletExtensionProfileOptions['setup'];
  /** Wait policy after profileSetup. Defaults to buildWalletExtensionProfile's behavior. */
  waitForState?: BuildWalletExtensionProfileOptions['waitForState'];
};

export type RealWalletExtensionFixtures = {
  realWalletExtensionOptions: RealWalletExtensionFixtureOptions;
  realWalletExtension: RealWalletExtensionSession;
};

const extensionPathFromEnv = (): string | undefined =>
  process.env.WEB3_TESTER_REAL_WALLET_EXTENSION_PATH || undefined;

const profileDirFromEnv = (): string | undefined =>
  process.env.WEB3_TESTER_REAL_WALLET_PROFILE_DIR || undefined;

const assertChromiumProject = (browserName: string): void => {
  if (browserName !== 'chromium') {
    throw new Error(
      '@marigoldlabs/web3-tester/real-wallet-extension-fixtures launch a Chromium extension context. ' +
        `The current Playwright project uses "${browserName}". Exclude real-extension tests from non-Chromium ` +
        'projects, or run them in a dedicated Chromium project.',
    );
  }
};

/**
 * Playwright fixtures for arbitrary Chromium wallet extensions. Each test
 * gets either the explicit profileDir or a disposable clone of a cached
 * profile prepared by profileSetup. `context` and `page` are rebound to the
 * persistent extension context.
 */
export const test = base.extend<RealWalletExtensionFixtures>({
  realWalletExtensionOptions: [
    async ({}, use) => {
      await use({});
    },
    { option: true },
  ],

  realWalletExtension: async ({ realWalletExtensionOptions, browserName }, use, testInfo) => {
    assertChromiumProject(browserName);

    const benchmark = benchmarkForTest(testInfo, { suite: 'real-wallet-extension' });
    let session: RealWalletExtensionSession | undefined;

    try {
      const options = realWalletExtensionOptions;
      const extensionPath = options.extensionPath ?? extensionPathFromEnv();
      if (!extensionPath) {
        throw new Error(
          'Real-wallet extension fixtures need extensionPath or ' +
            'WEB3_TESTER_REAL_WALLET_EXTENSION_PATH pointing at an unpacked Chromium wallet extension.',
        );
      }

      let profileDir = options.profileDir ?? profileDirFromEnv();

      if (!profileDir) {
        if (!options.profileCacheKey) {
          throw new Error(
            'Real-wallet extension fixtures need profileCacheKey to build a cached profile, ' +
              'or an explicit profileDir pointing at a prepared wallet profile.',
          );
        }
        const profileCacheKey = options.profileCacheKey;

        const cachedProfile = await benchmark.measure('realWalletExtension.buildProfile', () =>
          buildWalletExtensionProfile({
            baseURL: options.baseURL,
            cacheDir: options.cacheDir,
            cacheKey: profileCacheKey,
            extensionId: options.extensionId,
            extensionName: options.extensionName,
            extensionPath,
            force: options.forceProfile,
            headless: options.headless,
            initialPage: options.initialPage,
            launchArgs: options.launchArgs,
            locale: options.locale,
            setup: options.profileSetup,
            slowMo: options.slowMo,
            waitForState: options.waitForState,
          }),
        );
        profileDir = await benchmark.measure('realWalletExtension.cloneProfile', () =>
          cloneWalletProfile(
            cachedProfile,
            path.join(testInfo.outputDir, 'wallet-extension-profile'),
          ),
        );
      }

      session = await benchmark.measure('realWalletExtension.launch', () =>
        launchRealWalletExtension({
          baseURL: options.baseURL,
          extensionId: options.extensionId,
          extensionName: options.extensionName,
          extensionPath,
          headless: options.headless,
          initialPage: options.initialPage,
          launchArgs: options.launchArgs,
          locale: options.locale,
          profileDir,
          slowMo: options.slowMo,
        }),
      );

      await use(benchmarkObjectMethods(session, benchmark, { prefix: 'realWalletExtension', exclude: ['close'] }));
    } finally {
      if (session) {
        const activeSession = session;
        await benchmark.measure('realWalletExtension.close', () => activeSession.close().catch(() => undefined));
      }
      await benchmark.flush();
    }
  },

  context: async ({ realWalletExtension }, use) => {
    await use(realWalletExtension.context);
  },

  page: async ({ context }, use) => {
    const page: Page = await context.newPage();
    await use(page);
    await page.close().catch(() => undefined);
  },
});

export { expect } from './matchers.js';
