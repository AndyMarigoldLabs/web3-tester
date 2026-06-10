import type { Page } from '@playwright/test';
import { type Hex } from 'viem';
import type { MockWalletController } from './mock-wallet-controller.js';
export type WalletConnectMetadata = {
    name: string;
    description: string;
    url: string;
    icons: string[];
};
/** Structural IKeyValueStorage (getKeys/getEntries/getItem/setItem/removeItem). */
export type WalletConnectStorage = {
    getKeys(): Promise<string[]>;
    getEntries<T = unknown>(): Promise<[string, T][]>;
    getItem<T = unknown>(key: string): Promise<T | undefined>;
    setItem<T = unknown>(key: string, value: T): Promise<void>;
    removeItem(key: string): Promise<void>;
};
/** The slice of SignClient this module drives — the raw client is exposed as an escape hatch. */
export type WalletConnectSignClient = {
    on(event: string, handler: (payload: never) => void): unknown;
    off?(event: string, handler: (payload: never) => void): unknown;
    removeListener?(event: string, handler: (payload: never) => void): unknown;
    pair(args: {
        uri: string;
    }): Promise<unknown>;
    approve(args: {
        id: number;
        namespaces: Record<string, unknown>;
    }): Promise<{
        topic: string;
        acknowledged: () => Promise<{
            namespaces?: Record<string, unknown>;
        } | undefined>;
    }>;
    reject(args: {
        id: number;
        reason: unknown;
    }): Promise<void>;
    respond(args: {
        topic: string;
        response: unknown;
    }): Promise<void>;
    emit(args: {
        topic: string;
        event: {
            name: string;
            data: unknown;
        };
        chainId: string;
    }): Promise<void>;
    update(args: {
        topic: string;
        namespaces: Record<string, unknown>;
    }): Promise<unknown>;
    disconnect(args: {
        topic: string;
        reason: unknown;
    }): Promise<void>;
    core?: {
        relayer?: {
            transportClose?: () => Promise<void>;
        };
        heartbeat?: {
            stop?: () => void;
        };
    };
};
export type WalletConnectWalletOptions = {
    /**
     * The mock/live controller. EVERY session proposal and session_request
     * dispatches through its approval gating and transaction recording —
     * approveNext/autoApprove/holdNextRequest/simulateRejection govern WC
     * traffic exactly like injected traffic.
     */
    wallet: MockWalletController;
    /** Reown dashboard project id (the public relay requires one). */
    projectId: string;
    /** Defaults to the SDK default (wss://relay.walletconnect.org). */
    relayUrl?: string;
    /** Chains offered in the approved eip155 namespace. Default: [wallet.currentChainId]. */
    chains?: readonly (number | Hex)[];
    /** Namespace methods. Default: DEFAULT_WALLETCONNECT_METHODS. */
    methods?: readonly string[];
    /** Namespace events. Default: ['chainChanged', 'accountsChanged']. */
    events?: readonly string[];
    /** Peer metadata shown in the dapp UI. */
    metadata?: Partial<WalletConnectMetadata>;
    /**
     * Enforce the controller's allowedOrigins against the relay's
     * verifyContext origin. Default true. Note: when Verify reports
     * validation 'UNKNOWN' the origin derives from unattested proposer
     * metadata — a hostile dapp can spoof it, so origin scoping over WC is
     * weaker than the injected bridge. false dispatches with the controller's
     * bypassOriginCheck opt-out (approval gating still applies).
     */
    enforceOrigins?: boolean;
    /** SignClient storage override. Default: SDK in-memory (nothing on disk). */
    storage?: WalletConnectStorage;
};
export type WalletConnectSession = {
    topic: string;
    namespaces: Record<string, unknown>;
    peerMetadata: WalletConnectMetadata;
};
export type GetUriOptions = {
    /** Default 15_000. */
    timeoutMs?: number;
    /** Default 'wui-qr-code' (AppKit's QR element; its uri attribute is what Reown's own E2E suite reads). */
    selector?: string;
};
export declare const DEFAULT_WALLETCONNECT_METHODS: readonly string[];
/** @internal Test hook: stub the dynamic importer; call with no args to restore. */
export declare const __setWalletConnectModuleLoader: (loader?: (specifier: string) => Promise<unknown>) => void;
export type SessionRequestEvent = {
    id: number;
    topic: string;
    params: {
        request: {
            method: string;
            params?: unknown;
        };
        chainId: string;
    };
    verifyContext?: {
        verified?: {
            origin?: string;
            validation?: string;
        };
    };
};
export type SessionRequestResponse = {
    id: number;
    jsonrpc: '2.0';
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: string;
    };
};
/**
 * The session_request loop, exported for hermetic tests: validates the CAIP
 * chain against the approved set, switches the wallet when an approved
 * non-active chain is requested (single-active-chain semantics, like a
 * mobile wallet), and dispatches through the controller's gating. Errors map
 * through serializeRpcError, so 4001/4100/4200/4902/-32602 cross the relay
 * verbatim.
 */
export declare const createSessionRequestHandler: (wallet: MockWalletController, config: {
    chains: readonly Hex[];
    enforceOrigins: boolean;
}, respond: (topic: string, response: SessionRequestResponse) => Promise<void>) => ((event: SessionRequestEvent) => Promise<void>);
/**
 * Polls the AppKit/W3M modal for the pairing URI: Playwright CSS locators
 * pierce the shadow DOM, and AppKit's w3m-connecting-wc-qrcode renders
 * `<wui-qr-code uri=...>` as a real DOM attribute (the same contract
 * Reown's own laboratory tests read). For non-AppKit modals pass a
 * `selector` or use the connect() `getUri` hook.
 */
export declare function getWalletConnectUri(page: Page, options?: GetUriOptions): Promise<string>;
export declare class WalletConnectWallet {
    /** Underlying SignClient — escape hatch for protocol-level access. */
    readonly client: WalletConnectSignClient;
    private readonly wallet;
    private readonly utils;
    private chains;
    private readonly methods;
    private readonly events;
    private readonly enforceOrigins;
    private readonly sessionList;
    private readonly requestHandler;
    private readonly deleteHandler;
    private readonly unsubscribeProviderEvents;
    private closed;
    private constructor();
    /**
     * Async factory: dynamically imports the optional peers and throws an
     * install hint when they are missing.
     */
    static create(options: WalletConnectWalletOptions): Promise<WalletConnectWallet>;
    get sessions(): readonly WalletConnectSession[];
    /**
     * Pairs with a wc: URI, gates the session proposal through the controller
     * (as a synthetic eth_requestAccounts — approveNext('eth_requestAccounts')
     * arms it; the match callback receives the proposal payload), builds the
     * approved namespaces, and settles the session.
     */
    pair(options: {
        uri: string;
        timeoutMs?: number;
    }): Promise<WalletConnectSession>;
    /** Convenience: extract the URI from the dapp's modal, then pair(). */
    connect(page: Page, options?: GetUriOptions & {
        getUri?: (page: Page) => Promise<string>;
    }): Promise<WalletConnectSession>;
    /** Wallet-initiated disconnect; all sessions when topic is omitted. */
    disconnect(topic?: string): Promise<void>;
    /**
     * Best-effort teardown: disconnect sessions (5s cap), unsubscribe the
     * controller listener, close the relay transport, stop the heartbeat.
     * Always call in finally / fixture teardown.
     */
    close(): Promise<void>;
    private forwardProviderEvent;
}
//# sourceMappingURL=walletconnect.d.ts.map