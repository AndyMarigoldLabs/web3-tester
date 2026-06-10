import type { Page } from '@playwright/test';
import { type Address, type Hex } from 'viem';
import type { RpcClient, WalletProviderInfo } from './types.js';
export type RejectionRule = {
    methods?: readonly string[];
    message?: string;
};
export type HeldRequest = {
    method: string;
    params: readonly unknown[];
    approve: () => void;
    reject: (message?: string) => void;
};
export type SentTransactionRecord = {
    hash: Hex;
    from?: Address;
    to?: Hex;
    data?: Hex;
    value?: string;
};
export type MockWalletControllerOptions = {
    accounts: readonly Address[];
    chainId: number | Hex;
    providerInfo?: Partial<WalletProviderInfo>;
    additionalProviders?: readonly Partial<WalletProviderInfo>[];
    autoApprove?: boolean;
    connected?: boolean;
    /**
     * When set, only frames whose origin matches an entry (URL or origin
     * string) can reach the wallet; everything else gets a 4100 error. Leave
     * unset to serve every frame, like a real extension.
     */
    allowedOrigins?: readonly string[];
};
export declare class MockWalletController {
    private readonly page;
    private readonly rpcClient;
    private accounts;
    private chainId;
    private connected;
    private approveRequests;
    private rejectionQueue;
    private holdQueue;
    private approvalQueue;
    private readonly knownChainIds;
    private readonly allowedOrigins?;
    readonly sentTransactions: Hex[];
    readonly sentTransactionRequests: SentTransactionRecord[];
    constructor(page: Page, rpcClient: RpcClient, options: MockWalletControllerOptions);
    readonly providerInfo: WalletProviderInfo;
    readonly providerInfos: readonly WalletProviderInfo[];
    get primaryAccount(): Address;
    get currentChainId(): Hex;
    injectMockProvider(): Promise<void>;
    autoApprove(enabled?: boolean): void;
    /**
     * Arms approval for the next matching request while autoApprove is off —
     * the explicit per-call grant for real-key (live) wallets. Queued
     * rejections and holds still take precedence.
     *
     * A grant without `match` approves whatever matching request arrives first
     * and never expires, so any page script (including a third-party include on
     * an allowed origin) can race the dapp for it. Pass `match` to bind the
     * grant to the expected payload, or use holdNextRequest() to inspect the
     * request before deciding.
     */
    approveNext(methods?: string | readonly string[], match?: (method: string, params: readonly unknown[]) => boolean): void;
    simulateRejection(methods?: string | readonly string[], message?: string): Promise<void>;
    /**
     * Intercepts the next matching request and keeps it pending until the test
     * approves or rejects it — for asserting "confirm in your wallet" UI states.
     * Resolves once the page actually issues the request.
     */
    holdNextRequest(methods?: string | readonly string[]): Promise<HeldRequest>;
    /**
     * Resolves with the hash of the next transaction the page submits after
     * this call. Invoke before triggering the dapp action, then await it.
     */
    waitForNextTransaction(options?: {
        timeoutMs?: number;
    }): Promise<Hex>;
    setAccounts(accounts: readonly Address[]): Promise<void>;
    disconnect(): Promise<void>;
    reconnect(): Promise<void>;
    switchNetwork(chainId: number | Hex): Promise<void>;
    private emit;
    private consumeRule;
    private assertOriginAllowed;
    private assertUserApproved;
    private permissionResponse;
    private handleRpcRequest;
}
//# sourceMappingURL=mock-wallet-controller.d.ts.map