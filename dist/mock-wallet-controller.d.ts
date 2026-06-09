import type { Page } from '@playwright/test';
import { type Address, type Hex } from 'viem';
import type { RpcClient, WalletProviderInfo } from './types.js';
export type RejectionRule = {
    methods?: readonly string[];
    message?: string;
};
export type MockWalletControllerOptions = {
    accounts: readonly Address[];
    chainId: number | Hex;
    providerInfo?: Partial<WalletProviderInfo>;
    additionalProviders?: readonly Partial<WalletProviderInfo>[];
    autoApprove?: boolean;
    connected?: boolean;
};
export declare class MockWalletController {
    private readonly page;
    private readonly rpcClient;
    private accounts;
    private chainId;
    private connected;
    private approveRequests;
    private rejectionQueue;
    constructor(page: Page, rpcClient: RpcClient, options: MockWalletControllerOptions);
    readonly providerInfo: WalletProviderInfo;
    readonly providerInfos: readonly WalletProviderInfo[];
    get primaryAccount(): Address;
    get currentChainId(): Hex;
    injectMockProvider(): Promise<void>;
    autoApprove(enabled?: boolean): void;
    simulateRejection(methods?: string | readonly string[], message?: string): Promise<void>;
    setAccounts(accounts: readonly Address[]): Promise<void>;
    disconnect(): Promise<void>;
    reconnect(): Promise<void>;
    switchNetwork(chainId: number | Hex): Promise<void>;
    private emit;
    private consumeRejection;
    private assertUserApproved;
    private handleRpcRequest;
}
//# sourceMappingURL=mock-wallet-controller.d.ts.map