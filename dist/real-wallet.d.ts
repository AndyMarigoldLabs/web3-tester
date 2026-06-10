import { type BrowserContext } from '@playwright/test';
export type RealWalletProfile = {
    profileDirectory?: string;
    userDataDir: string;
};
export type RealWalletSetup = {
    password?: string;
    seedPhrase?: string;
};
export type RealWalletGasSettings = 'site' | 'low' | 'market' | 'aggressive' | {
    gasLimit?: number;
    maxBaseFee: number;
    priorityFee: number;
};
export type RealWalletLaunchOptions = {
    baseURL?: string;
    expectedAddress?: string;
    extensionName?: string;
    extensionPath: string;
    headless?: boolean;
    profileDir: string;
    setup?: RealWalletSetup;
    slowMo?: number;
};
export type RealWalletNetwork = {
    name: string;
    rpcUrl: string;
    chainId: number;
    symbol: string;
    blockExplorerUrl?: string;
};
export type RealWalletToken = {
    /** ERC-20 contract address (0x + 40 hex). */
    address: string;
    /** Optional symbol override; MetaMask usually autofills from the contract. */
    symbol?: string;
    /** Optional decimals override. */
    decimals?: number;
    /**
     * 13.x only: network to import the token on (name as shown in the import
     * modal's network selector). Defaults to the wallet's active network.
     */
    networkName?: string;
};
export type RealWalletController = {
    addNetwork(network: RealWalletNetwork): Promise<void>;
    approveNewNetwork(): Promise<void>;
    approveSwitchNetwork(): Promise<void>;
    approveTokenPermission(options?: {
        gasSetting?: RealWalletGasSettings;
        spendLimit?: 'max' | number;
    }): Promise<void>;
    confirmSignature(): Promise<void>;
    confirmTransaction(options?: {
        gasSetting?: RealWalletGasSettings;
    }): Promise<void>;
    connectToDapp(accounts?: string[]): Promise<void>;
    getAccountAddress(): Promise<string>;
    rejectNewNetwork(): Promise<void>;
    rejectSignature(): Promise<void>;
    rejectSwitchNetwork(): Promise<void>;
    rejectTokenPermission(): Promise<void>;
    rejectTransaction(): Promise<void>;
    switchNetwork(name: string, options?: {
        chainId?: number;
    }): Promise<void>;
    /** Creates the next derived account on the active SRP, optionally named. */
    addNewAccount(name?: string): Promise<void>;
    /** Synpress-parity alias for approveAddToken(). */
    addNewToken(): Promise<void>;
    /** Approves a pending wallet_watchAsset ("Add suggested tokens") prompt. */
    approveAddToken(): Promise<void>;
    rejectAddToken(): Promise<void>;
    /**
     * confirmTransaction, then watch the newest activity row until confirmed.
     * The hash is read best-effort via "Copy transaction ID" — undefined when
     * the clipboard read fails (the mining wait still completes).
     */
    confirmTransactionAndWaitForMining(options?: {
        gasSetting?: RealWalletGasSettings;
        /** Wait budget for the activity row to reach confirmed. Default 60_000. */
        timeoutMs?: number;
    }): Promise<{
        txHash?: `0x${string}`;
    }>;
    /** Manual token import: tokens tab → Import tokens → Custom token form. */
    importToken(token: RealWalletToken): Promise<void>;
    /** Imports a private-key account ("Imported" keyring); throws on MetaMask errors (e.g. duplicates). */
    importWalletFromPrivateKey(privateKey: string): Promise<void>;
    /** Global menu → Lock; resolves once the unlock screen is visible. */
    lock(): Promise<void>;
    renameAccount(currentName: string, newName: string): Promise<void>;
    /** Clears activity/nonce data (12.x: Advanced; 13.x: Developer tools). */
    resetAccount(): Promise<void>;
    /** Selects an account in the picker by display name or (best-effort on 13.x) address. */
    switchAccount(nameOrAddress: string): Promise<void>;
    /** Idempotent when `on` is given (reads the toggle first); blind toggle when omitted. */
    toggleShowTestNetworks(on?: boolean): Promise<void>;
    /** Unlocks with the given password or the password from launch setup. */
    unlock(password?: string): Promise<void>;
};
export type RealWalletSession = RealWalletController & {
    close(): Promise<void>;
    context: BrowserContext;
    extensionId: string;
    wallet: RealWalletController;
};
export declare function resolveRealWalletProfile(profileDir: string): RealWalletProfile;
/** @internal Validates and trims a 32-byte hex private key (0x optional). */
export declare function normalizePrivateKey(privateKey: string): string;
/** @internal */
export declare function isFullTxHash(value: string | undefined): value is `0x${string}`;
/**
 * @internal Matches an account picker row by display name, or by full /
 * shortened address when the identifier is an address.
 */
export declare function accountRowMatcher(identifier: string): RegExp;
export declare function launchRealWallet(options: RealWalletLaunchOptions): Promise<RealWalletSession>;
//# sourceMappingURL=real-wallet.d.ts.map