import { type BuildWalletExtensionProfileOptions } from './real-wallet-cache.js';
import { type RealWalletExtensionLaunchOptions, type RealWalletExtensionSession } from './real-wallet-extension.js';
export type RealWalletExtensionFixtureOptions = Omit<RealWalletExtensionLaunchOptions, 'extensionPath' | 'profileDir'> & {
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
/**
 * Playwright fixtures for arbitrary Chromium wallet extensions. Each test
 * gets either the explicit profileDir or a disposable clone of a cached
 * profile prepared by profileSetup. `context` and `page` are rebound to the
 * persistent extension context.
 */
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & RealWalletExtensionFixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
export { expect } from './matchers.js';
//# sourceMappingURL=real-wallet-extension-fixtures.d.ts.map