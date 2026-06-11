/**
 * The MetaMask build the adapter's selectors are maintained against. Bump
 * deliberately and re-run the real-wallet smoke suite when changing it
 * (`npm run smoke:real-wallet`).
 *
 * The adapter drives one UI generation per launch as explicit configuration
 * (derived from the extension manifest, overridable via the `generation`
 * option): 13.x (the "multichain" UI) is validated end to end and gates
 * releases; the last 12.x line stays supported on a best-effort cadence. Set
 * WEB3_TESTER_METAMASK_VERSION=12.23.1 to drive the older generation.
 */
export declare const DEFAULT_METAMASK_VERSION = "13.34.1";
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