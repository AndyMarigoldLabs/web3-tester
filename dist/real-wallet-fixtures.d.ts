import { type BuildWalletProfileOptions } from './real-wallet-cache.js';
import { type RealWalletSession, type RealWalletSetup, type WalletGeneration } from './real-wallet.js';
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
/**
 * Playwright fixtures for real-MetaMask tests. Each test gets a disposable
 * clone of a cached, pre-onboarded profile (built once per seed phrase +
 * extension version), so tests are isolated, parallel-safe, and skip
 * onboarding cost after the first run. `context` and `page` are rebound to
 * the persistent extension context.
 */
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & RealWalletFixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
export { expect } from './matchers.js';
//# sourceMappingURL=real-wallet-fixtures.d.ts.map