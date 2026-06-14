import { type BrowserContext, type Page } from '@playwright/test';
export type RealWalletProfile = {
    profileDirectory?: string;
    userDataDir: string;
};
export type BrowserExtensionManifest = {
    manifest_version?: number;
    name?: string;
    version?: string;
    action?: {
        default_popup?: string;
    };
    browser_action?: {
        default_popup?: string;
    };
    options_ui?: {
        page?: string;
    };
    side_panel?: {
        default_path?: string;
    };
    [key: string]: unknown;
};
export type RealWalletExtensionLaunchOptions = {
    baseURL?: string;
    /**
     * Exact Chrome extension display name used when runtime/service-worker
     * discovery is inconclusive. For localized manifests (`__MSG_*__`), pass
     * this explicitly or pass `extensionId`.
     */
    extensionName?: string;
    /**
     * Known extension ID. Useful for persistent profiles that already have a
     * wallet installed or for extensions without a service worker.
     */
    extensionId?: string;
    /** Path to an unpacked Chrome extension directory. */
    extensionPath: string;
    /**
     * Run the browser headless. There is deliberately no default — choose
     * explicitly here or via WEB3_TESTER_REAL_WALLET_HEADLESS=true|false.
     */
    headless?: boolean;
    /**
     * Extension page to open after launch. Defaults to the manifest action
     * popup/options/side-panel page when present; pass false to leave all
     * extension pages untouched.
     */
    initialPage?: string | false;
    /** Additional Chromium launch args appended after extension args. */
    launchArgs?: readonly string[];
    locale?: string;
    profileDir: string;
    slowMo?: number;
};
export type RealWalletExtensionSession = {
    close(): Promise<void>;
    context: BrowserContext;
    extensionId: string;
    extensionPath: string;
    manifest: BrowserExtensionManifest;
    /** Page opened from `initialPage`, when configured/resolved. */
    page?: Page;
    profile: RealWalletProfile;
    extensionUrl(page?: string): string;
    openPage(page?: string): Promise<Page>;
};
export declare function resolveRealWalletProfile(profileDir: string): RealWalletProfile;
/**
 * Resolves the headed/headless choice for real-wallet extension launches.
 * The explicit option wins over the environment.
 */
export declare function resolveRealWalletHeadless(explicit?: boolean): boolean;
export declare function readExtensionManifest(extensionPath: string): BrowserExtensionManifest;
export declare function extensionManifestName(extensionPath: string): string | undefined;
export declare function extensionManifestDefaultPage(manifest: BrowserExtensionManifest): string | undefined;
export declare function extensionPageUrl(extensionId: string, page?: string): string;
export declare function resolveExtensionPageUrl(extensionId: string, page?: string): string;
export declare function extensionIdFromUrl(url: string): string | undefined;
export declare function discoverRealWalletExtensionId(context: BrowserContext, options?: {
    extensionName?: string;
    timeoutMs?: number;
}): Promise<string>;
export declare function openRealWalletExtensionPage(context: BrowserContext, extensionId: string, page?: string): Promise<Page>;
export declare function launchRealWalletExtension(options: RealWalletExtensionLaunchOptions): Promise<RealWalletExtensionSession>;
//# sourceMappingURL=real-wallet-extension.d.ts.map