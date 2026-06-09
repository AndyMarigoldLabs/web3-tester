import { type BrowserContext } from '@playwright/test';
export type RealWalletProfile = {
    profileDirectory?: string;
    userDataDir: string;
};
export type RealWalletSetup = {
    password: string;
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
export type RealWalletController = {
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
    rejectSignature(): Promise<void>;
    rejectTransaction(): Promise<void>;
};
export type RealWalletSession = {
    approveTokenPermission(options?: {
        gasSetting?: RealWalletGasSettings;
        spendLimit?: 'max' | number;
    }): Promise<void>;
    close(): Promise<void>;
    confirmSignature(): Promise<void>;
    confirmTransaction(options?: {
        gasSetting?: RealWalletGasSettings;
    }): Promise<void>;
    connectToDapp(accounts?: string[]): Promise<void>;
    context: BrowserContext;
    extensionId: string;
    getAccountAddress(): Promise<string>;
    rejectSignature(): Promise<void>;
    rejectTransaction(): Promise<void>;
    wallet: RealWalletController;
};
export declare function resolveRealWalletProfile(profileDir: string): RealWalletProfile;
export declare function launchRealWallet(options: RealWalletLaunchOptions): Promise<RealWalletSession>;
//# sourceMappingURL=real-wallet.d.ts.map