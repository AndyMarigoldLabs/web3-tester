/**
 * The MetaMask build the adapter's selectors are maintained against. Bump
 * deliberately and re-run the real-wallet smoke suite when changing it.
 *
 * Pinned to the last 12.x line because 13.x ships MetaMask's "multichain" UI
 * redesign, which renames the account/network/details selectors the read and
 * action helpers depend on (e.g. the account picker uses
 * `multichain-account-cell-*` and there is no `app-header-copy-button`).
 * Onboarding itself works on 13.x — finishMetaMaskOnboarding handles the
 * side-panel completion and the debounced-IndexedDB persistence — but the
 * post-onboarding helpers need a selector pass before 13.x can be the
 * default. See the version-pin note in docs/API.md.
 */
export declare const DEFAULT_METAMASK_VERSION = "12.23.1";
export type PrepareMetaMaskExtensionOptions = {
    /** Release version, e.g. "13.34.1". Defaults to WEB3_TESTER_METAMASK_VERSION or the pinned default. */
    version?: string;
    /** Directory unpacked extensions are cached in. Defaults to ~/.cache/web3-tester/metamask. */
    cacheDir?: string;
    /** Full download URL override (e.g. an internal mirror). */
    downloadUrl?: string;
    /** Optional sha256 (hex) of the zip for integrity verification. */
    sha256?: string;
    /** Re-download even if a cached copy exists. */
    force?: boolean;
};
export declare const defaultExtensionCacheDir: () => string;
/**
 * Downloads and unpacks a pinned MetaMask release into a local cache and
 * returns the unpacked extension directory, suitable for
 * launchRealWallet({ extensionPath }). Subsequent calls hit the cache.
 */
export declare function prepareMetaMaskExtension(options?: PrepareMetaMaskExtensionOptions): Promise<string>;
/** Reads the version field of an unpacked extension's manifest.json. */
export declare function extensionManifestVersion(extensionPath: string): string;
//# sourceMappingURL=metamask-extension.d.ts.map