import { type RealWalletSession, type RealWalletSetup, type WalletGeneration } from './real-wallet.js';
export type BuildWalletProfileOptions = {
    /** Unpacked MetaMask extension directory (see prepareMetaMaskExtension). */
    extensionPath: string;
    /** Wallet setup; seedPhrase is required to build a profile. */
    setup: RealWalletSetup;
    /** Directory cached profiles live in. Defaults to ~/.cache/web3-tester/profiles. */
    cacheDir?: string;
    /**
     * Run the one-time onboarding headless. No default — set it here or via
     * WEB3_TESTER_REAL_WALLET_HEADLESS=true|false (see RealWalletLaunchOptions).
     */
    headless?: boolean;
    /**
     * UI generation to drive during onboarding/customization. Defaults to the
     * extension manifest's major version; set it (matching the per-test launch)
     * for custom builds whose manifest version does not reflect their UI.
     */
    generation?: WalletGeneration;
    /** Rebuild even if a cached profile exists. */
    force?: boolean;
    /**
     * One-time profile customization (import keys, add accounts/networks/
     * tokens) baked into the cached profile — `key` joins the cache key, so
     * bump it whenever `run` changes. The builder waits for extension state to
     * flush to disk (13.x persists to IndexedDB with a debounce) before
     * closing, so mutations survive profile close. Note: whatever account/
     * network `run` leaves selected is what every cloned per-test profile
     * boots with — switch back to the primary account before returning if
     * tests expect the defaults.
     */
    customize?: {
        key: string;
        run(session: RealWalletSession): Promise<void>;
    };
};
/**
 * Polls the profile's extension storage (IndexedDB leveldb + blob and Local
 * Extension Settings) from Node until a write newer than `since` lands and
 * the directories stay quiet for `quietMs` (default 1500ms — 500ms of margin
 * above MetaMask 13.x's verified 1000ms OperationSafener debounce). Times
 * out silently; the customize-persistence smoke test is the regression trap
 * for a missed flush.
 */
export declare function waitForExtensionStatePersisted(profileDir: string, extensionId: string, options?: {
    since?: number;
    quietMs?: number;
    timeoutMs?: number;
}): Promise<void>;
export declare const defaultProfileCacheDir: () => string;
/**
 * Builds (once) and returns a cached, fully onboarded MetaMask profile
 * directory keyed by (seed phrase, password, extension version). The first
 * call walks MetaMask onboarding in a real browser; subsequent calls return
 * instantly. Use cloneWalletProfile to obtain a disposable per-test copy —
 * never launch the cached directory directly.
 */
export declare function buildWalletProfile(options: BuildWalletProfileOptions): Promise<string>;
/**
 * Copies a cached profile into a disposable directory (per test or per
 * worker) so parallel runs never collide on Chromium's profile singleton
 * lock and tests cannot dirty the cache.
 */
export declare function cloneWalletProfile(cachedProfileDir: string, targetDir: string): Promise<string>;
//# sourceMappingURL=real-wallet-cache.d.ts.map