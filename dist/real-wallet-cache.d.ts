import { type RealWalletSetup } from './real-wallet.js';
export type BuildWalletProfileOptions = {
    /** Unpacked MetaMask extension directory (see prepareMetaMaskExtension). */
    extensionPath: string;
    /** Wallet setup; seedPhrase is required to build a profile. */
    setup: RealWalletSetup;
    /** Directory cached profiles live in. Defaults to ~/.cache/web3-tester/profiles. */
    cacheDir?: string;
    /** Run the one-time onboarding in headless (new headless) mode. */
    headless?: boolean;
    /** Rebuild even if a cached profile exists. */
    force?: boolean;
};
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