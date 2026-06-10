import type { Page } from '@playwright/test';
import { type Address, type Hex } from 'viem';
import type { JsonRpcRequest, RpcClient, WalletProviderInfo } from './types.js';
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
    /** The wallet's active chain when the transaction was sent. */
    chainId: Hex;
    from?: Address;
    to?: Hex;
    data?: Hex;
    value?: string;
};
/** A chain backend: any RpcClient, or an http(s) RPC URL string. */
export type ChainBackend = RpcClient | string;
export type HttpRpcClientOptions = {
    /** Request timeout in ms. Defaults to viem's transport default (10s). */
    timeout?: number;
    /** Retry count. Defaults to 0 so dead endpoints fail deterministically. */
    retryCount?: number;
};
/**
 * Adapter: EIP-1193 RpcClient over a plain JSON-RPC URL (viem http
 * transport). URL-backed chains serve reads, eth_sendRawTransaction, and
 * dapp-side flows; node-side signing (personal_sign, eth_sendTransaction)
 * needs a node that signs — back those chains with Anvil or a
 * PrivateKeyRpcClient instead.
 */
export declare function httpRpcClient(url: string, options?: HttpRpcClientOptions): RpcClient;
export type MockWalletControllerOptions = {
    accounts: readonly Address[];
    chainId: number | Hex;
    /**
     * Additional chains the wallet can switch to, keyed by chain id (number or
     * 0x-hex). The constructor's rpcClient remains the backend for `chainId`;
     * listing `chainId` here too is a construction error. Forwarded calls
     * route to the active chain's backend; a known-but-unbacked chain throws
     * 4901 (EIP-1193 "Chain Disconnected").
     */
    chains?: Readonly<Record<number | Hex, ChainBackend>>;
    /**
     * Honor dapp-supplied rpcUrls[0] in wallet_addEthereumChain: the URL is
     * probed (its eth_chainId must match, per EIP-3085) and registered as the
     * chain's backend. Default false: the chain id is registered (so the
     * 4902 -> add -> switch flow completes) but forwarded calls on it throw
     * 4901 until a backend is registered via `chains` or addChain(). Never
     * enable this for wallets fronting a real key.
     */
    trustDappRpcUrls?: boolean;
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
    private readonly chainBackends;
    private readonly trustDappRpcUrls;
    private readonly allowedOrigins?;
    private readonly providerEventListeners;
    private sendQueue;
    private nodeAccountsCache?;
    readonly sentTransactions: Hex[];
    readonly sentTransactionRequests: SentTransactionRecord[];
    constructor(page: Page, rpcClient: RpcClient, options: MockWalletControllerOptions);
    readonly providerInfo: WalletProviderInfo;
    readonly providerInfos: readonly WalletProviderInfo[];
    get primaryAccount(): Address;
    /** Current account list; index 0 is the selected account. */
    get currentAccounts(): readonly Address[];
    get currentChainId(): Hex;
    /** Chain ids that currently have an RPC backend, canonical hex. */
    get backedChainIds(): readonly Hex[];
    /**
     * Test-side chain registration (Synpress addNetwork analogue): registers
     * the backend and marks the chain known — no approval gate, no probe, and
     * re-registration overwrites (tests may rewire).
     */
    addChain(chainId: number | Hex, backend: ChainBackend): void;
    /**
     * Dispatch a request arriving from a non-injected transport (e.g. a
     * WalletConnect session). Approval gating applies exactly as for injected
     * requests. When allowedOrigins is configured, `context.origin` is
     * enforced; an absent origin counts as "null" and is refused.
     */
    handleExternalRequest(request: JsonRpcRequest, context?: {
        origin?: string;
    }): Promise<unknown>;
    /**
     * Observe provider events (chainChanged, accountsChanged, connect,
     * disconnect) node-side — the hook non-injected transports use to push
     * session events. Dispatch is fire-and-forget; listener errors are
     * swallowed. Returns an unsubscribe function.
     */
    onProviderEvent(listener: (event: string, payload: unknown) => void): () => void;
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
    /**
     * Replaces the account set (and reconnects a disconnected wallet — unlike
     * switchAccount, which only reorders). Accounts are validated against the
     * backing node's eth_accounts; pass { allowUnknownAccounts: true } only
     * for custom RpcClients whose account list the probe cannot see.
     */
    setAccounts(accounts: readonly Address[], options?: {
        allowUnknownAccounts?: boolean;
    }): Promise<void>;
    /**
     * Re-selects one of the wallet's existing accounts: moves it to index 0
     * (MetaMask orders eth_accounts most-recently-selected first) and emits
     * accountsChanged with the reordered array. No event when it is already
     * selected, and — unlike setAccounts — no reconnect while disconnected:
     * the reorder stays internal until the wallet reconnects.
     */
    switchAccount(address: Address): Promise<void>;
    disconnect(): Promise<void>;
    reconnect(): Promise<void>;
    switchNetwork(chainId: number | Hex): Promise<void>;
    private emit;
    private clientForChain;
    private get activeRpcClient();
    private enqueueSend;
    private consumeRule;
    private fetchNodeAccounts;
    private assertAccountsKnownToNode;
    private assertOriginAllowed;
    private assertUserApproved;
    private permissionResponse;
    private handleRpcRequest;
}
//# sourceMappingURL=mock-wallet-controller.d.ts.map