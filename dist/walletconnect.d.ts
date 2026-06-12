import type { Page } from '@playwright/test';
import { type Hex } from 'viem';
import type { MockWalletController } from './mock-wallet-controller.js';
import { type WalletPersona, type WalletPersonaInput } from './wallet-personas.js';
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
export type WalletConnectEventMap = {
    session_request: SessionRequestEvent;
    session_proposal: SessionProposalEvent;
    session_authenticate: SessionAuthenticateEvent;
    session_delete: {
        topic: string;
    };
};
type WalletConnectEventHandler<Event extends keyof WalletConnectEventMap> = (payload: WalletConnectEventMap[Event]) => void | Promise<void>;
export type WalletConnectSignClient = {
    on<Event extends keyof WalletConnectEventMap>(event: Event, handler: WalletConnectEventHandler<Event>): unknown;
    off?<Event extends keyof WalletConnectEventMap>(event: Event, handler: WalletConnectEventHandler<Event>): unknown;
    removeListener?<Event extends keyof WalletConnectEventMap>(event: Event, handler: WalletConnectEventHandler<Event>): unknown;
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
    formatAuthMessage(args: {
        request: Record<string, unknown>;
        iss: string;
    }): string;
    approveSessionAuthenticate(args: {
        id: number;
        auths: readonly WalletConnectCacao[];
    }): Promise<{
        session?: {
            topic: string;
            namespaces?: Record<string, unknown>;
            peer?: {
                metadata?: WalletConnectMetadata;
            };
        };
    }>;
    rejectSessionAuthenticate(args: {
        id: number;
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
export type WalletConnectSolanaOptions = {
    /** CAIP-2 Solana chains to approve. Defaults to the persona/default Solana provider chains. */
    chains?: readonly string[];
    /** Base58 public key used in approved accounts and mock signatures. */
    publicKey?: string;
    /** Solana namespace methods. Default: DEFAULT_WALLETCONNECT_SOLANA_METHODS. */
    methods?: readonly string[];
    /** Solana namespace events. Default: ['accountsChanged']. */
    events?: readonly string[];
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
    /** Wallet persona used for SignClient peer metadata. */
    persona?: WalletPersona | WalletPersonaInput;
    /**
     * EVM/eip155 namespace support. Defaults to false for personas with
     * `evm: false`, true otherwise.
     */
    evm?: boolean;
    /**
     * Solana namespace support. Defaults to the persona's Solana provider when
     * present; pass false to suppress it or an object to override chains/key/methods.
     */
    solana?: boolean | WalletConnectSolanaOptions;
    /**
     * Handle WalletConnect One-Click Auth / SIWE requests through
     * session_authenticate. Default true. Set false to rely on sign-client's
     * fallback session-proposal + personal_sign path.
     */
    sessionAuthenticate?: boolean;
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
    /**
     * WalletConnect Core storage/global-cache prefix. Tests that create both a
     * dapp SignClient and wallet SignClient in one process should give each
     * peer a distinct prefix. Default: a unique web3-tester wallet prefix.
     */
    customStoragePrefix?: string;
};
export type WalletConnectSession = {
    topic: string;
    namespaces: Record<string, unknown>;
    peerMetadata: WalletConnectMetadata;
};
export type GetUriOptions = {
    /** Default 15_000. */
    timeoutMs?: number;
    /**
     * Legacy single selector. Defaults to 'wui-qr-code' (AppKit's QR element;
     * its uri attribute is what Reown's own E2E suite reads).
     */
    selector?: string;
    /** Additional URI-bearing elements to probe. */
    selectors?: readonly string[];
    /** Attributes read from selector matches. Default: uri, data-uri, href, value. */
    attributes?: readonly string[];
    /** Text/value-bearing elements to probe. Default: textarea, input, code, pre, [data-wc-uri]. */
    textSelectors?: readonly string[];
    /** Legacy single copy control selector. */
    copyButtonSelector?: string;
    /** Copy controls to click before reading navigator.clipboard. */
    copyButtonSelectors?: readonly string[];
};
export declare const DEFAULT_WALLETCONNECT_METHODS: readonly string[];
export declare const DEFAULT_WALLETCONNECT_COINBASE_METHODS: readonly string[];
export declare const DEFAULT_WALLETCONNECT_SOLANA_METHODS: readonly string[];
/** @internal Test hook: stub the dynamic importer; call with no args to restore. */
export declare const __setWalletConnectModuleLoader: (loader?: (specifier: string) => Promise<unknown>) => void;
export type WalletConnectSolanaNamespace = {
    chains: readonly string[];
    publicKey: string;
    methods: readonly string[];
    events: readonly string[];
};
type SessionProposalEvent = {
    id: number;
    params?: {
        pairingTopic?: string;
        proposer?: {
            metadata?: WalletConnectMetadata;
        };
        requiredNamespaces?: unknown;
        optionalNamespaces?: unknown;
    };
    verifyContext?: {
        verified?: {
            origin?: string;
            validation?: string;
        };
    };
};
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
export type WalletConnectCacao = {
    h: {
        t: 'caip122';
    };
    p: Record<string, unknown> & {
        iss: string;
    };
    s: {
        t: 'eip191' | 'eip1271';
        s: string;
        m?: string;
    };
};
export type SessionAuthenticateEvent = {
    id: number;
    topic: string;
    params: {
        requester?: {
            metadata?: WalletConnectMetadata;
        };
        authPayload: Record<string, unknown> & {
            chains?: unknown;
        };
        expiryTimestamp?: number;
    };
    verifyContext?: {
        verified?: {
            origin?: string;
            validation?: string;
        };
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
    getChains?: () => readonly Hex[];
    enforceOrigins: boolean;
    solana?: WalletConnectSolanaNamespace;
}, respond: (topic: string, response: SessionRequestResponse) => Promise<void>) => ((event: SessionRequestEvent) => Promise<void>);
export declare const createSessionAuthenticateHandler: (wallet: MockWalletController, config: {
    chains: readonly Hex[];
    getChains?: () => readonly Hex[];
    enforceOrigins: boolean;
}, auth: {
    approve(id: number, auths: readonly WalletConnectCacao[]): Promise<{
        session?: {
            topic: string;
            namespaces?: Record<string, unknown>;
            peer?: {
                metadata?: WalletConnectMetadata;
            };
        };
    }>;
    buildAuthObject(requestPayload: Record<string, unknown>, signature: {
        t: "eip191" | "eip1271";
        s: string;
        m?: string;
    }, iss: string): WalletConnectCacao;
    formatAuthMessage(args: {
        request: Record<string, unknown>;
        iss: string;
    }): string;
    getSdkError(code: string): unknown;
    onSession?(session: WalletConnectSession): void;
    reject(id: number, reason: unknown): Promise<void>;
}) => ((event: SessionAuthenticateEvent) => Promise<void>);
/**
 * Polls common WalletConnect QR/modal surfaces for a pairing URI. Defaults
 * keep the AppKit/W3M `wui-qr-code[uri]` contract, then fall back to generic
 * URI attributes, text/value-bearing elements, and AppKit's copy button.
 * For unusual modals pass selectors/textSelectors/copyButtonSelector or use
 * the connect() getUri hook.
 */
export declare function getWalletConnectUri(page: Page, options?: GetUriOptions): Promise<string>;
export declare class WalletConnectWallet {
    /** Underlying SignClient — escape hatch for protocol-level access. */
    readonly client: WalletConnectSignClient;
    private readonly wallet;
    private readonly utils;
    private chains;
    private readonly evm;
    private readonly methods;
    private readonly events;
    private readonly solana?;
    private readonly enforceOrigins;
    private readonly sessionList;
    private readonly requestHandler;
    private readonly authHandler?;
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
export {};
//# sourceMappingURL=walletconnect.d.ts.map