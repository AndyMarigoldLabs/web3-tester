import { type RealWalletSession, type RealWalletSetup } from './real-wallet.js';
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
/**
 * Playwright fixtures for real-MetaMask tests. Each test gets a disposable
 * clone of a cached, pre-onboarded profile (built once per seed phrase +
 * extension version), so tests are isolated, parallel-safe, and skip
 * onboarding cost after the first run. `context` and `page` are rebound to
 * the persistent extension context.
 */
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & RealWalletFixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
export { expect } from '@playwright/test';
//# sourceMappingURL=real-wallet-fixtures.d.ts.map