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
    rejectTransaction(): Promise<void>;
    switchNetwork(name: string): Promise<void>;
};
export type RealWalletSession = RealWalletController & {
    close(): Promise<void>;
    context: BrowserContext;
    extensionId: string;
    wallet: RealWalletController;
};
export declare function resolveRealWalletProfile(profileDir: string): RealWalletProfile;
export declare function launchRealWallet(options: RealWalletLaunchOptions): Promise<RealWalletSession>;
//# sourceMappingURL=real-wallet.d.ts.map