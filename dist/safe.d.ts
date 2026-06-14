import type { Page } from '@playwright/test';
import { type Address, type Hex } from 'viem';
import type { JsonRpcRequest, RpcClient } from './types.js';
export type SafeOperation = 0 | 1;
export type SafeTransactionData = {
    to: Address;
    value?: bigint | number | string;
    data?: Hex;
    operation?: SafeOperation;
    safeTxGas?: bigint | number | string;
    baseGas?: bigint | number | string;
    gasPrice?: bigint | number | string;
    gasToken?: Address;
    refundReceiver?: Address;
    nonce: bigint | number | string;
};
export type NormalizedSafeTransactionData = {
    to: Address;
    value: string;
    data: Hex;
    operation: SafeOperation;
    safeTxGas: string;
    baseGas: string;
    gasPrice: string;
    gasToken: Address;
    refundReceiver: Address;
    nonce: string;
};
export type SafeTransactionTypedDataMessage = {
    to: Address;
    value: bigint;
    data: Hex;
    operation: SafeOperation;
    safeTxGas: bigint;
    baseGas: bigint;
    gasPrice: bigint;
    gasToken: Address;
    refundReceiver: Address;
    nonce: bigint;
};
export type SafeTransactionTypedData = {
    domain: {
        chainId: bigint;
        verifyingContract: Address;
    };
    primaryType: 'SafeTx';
    types: typeof SAFE_TRANSACTION_TYPED_DATA_TYPES;
    message: SafeTransactionTypedDataMessage;
};
export type SafeTransactionHashStrategy = 'eip712' | 'fixture';
export type SafeTransactionProposal = {
    safeAddress: Address;
    senderAddress: Address;
    safeTxHash?: Hex;
    senderSignature: Hex;
    confirmationsRequired?: number;
    origin?: string;
    data: SafeTransactionData;
};
export type SafeTransactionConfirmation = {
    owner: Address;
    signature: Hex;
    submissionDate?: string;
};
export type SafeMultisigTransaction = NormalizedSafeTransactionData & {
    safeAddress: Address;
    safeTxHash: Hex;
    senderAddress: Address;
    origin?: string;
    confirmations: SafeTransactionConfirmation[];
    confirmationsRequired?: number;
    isExecuted: boolean;
    transactionHash?: Hex;
    executorAddress?: Address;
    submissionDate?: string;
};
export type SafeTransactionService = {
    proposeTransaction(proposal: SafeTransactionProposal): Promise<SafeMultisigTransaction>;
    confirmTransaction(safeTxHash: Hex, confirmation: SafeTransactionConfirmation): Promise<SafeMultisigTransaction>;
    getTransaction(safeTxHash: Hex): Promise<SafeMultisigTransaction>;
    listTransactions(safeAddress: Address): Promise<SafeMultisigTransaction[]>;
    listConfirmations(safeTxHash: Hex): Promise<SafeTransactionConfirmation[]>;
    markExecuted?(safeTxHash: Hex, execution: {
        transactionHash: Hex;
        executorAddress: Address;
    }): Promise<SafeMultisigTransaction>;
};
export type SafeTransactionServiceClientOptions = {
    /**
     * Transaction Service base URL. Include the API prefix if your deployment
     * requires one, e.g. https://safe-transaction-sepolia.safe.global/api/v1.
     */
    baseUrl: string;
    /** Optional prefix appended after baseUrl, e.g. '/api/v1' or '/v1'. */
    apiPrefix?: string;
    /**
     * Chain ID used to derive Safe EIP-712 transaction hashes when a proposal
     * does not provide safeTxHash. If omitted, callers should pass safeTxHash
     * explicitly for real Safe Transaction Service deployments.
     */
    chainId?: number | bigint;
    /**
     * Hashes proposed transactions as protocol-compatible EIP-712 when chainId
     * is configured. Use 'fixture' to keep deterministic local fixture hashes.
     */
    safeTxHashStrategy?: SafeTransactionHashStrategy;
    fetch?: typeof fetch;
    headers?: Record<string, string>;
};
export type SafeWalletHarnessOptions = {
    safeAddress: Address;
    owners: readonly Address[];
    threshold: number;
    chainId: number | bigint;
    transactionService: SafeTransactionService;
    /**
     * Optional execution backend. When present, executeTransaction broadcasts the
     * transaction data as an eth_sendTransaction from the executor address, then
     * marks the service transaction executed.
     */
    rpcClient?: RpcClient;
    /** Defaults to protocol-compatible EIP-712 Safe transaction hashes. */
    safeTxHashStrategy?: SafeTransactionHashStrategy;
};
export type SafeAppSdkRequest = {
    id: string;
    method: string;
    params?: unknown;
    env?: {
        sdkVersion?: string;
    };
};
export type SafeAppBridgeOptions = {
    allowedOrigins?: readonly string[];
    addressBook?: readonly {
        address: Address;
        chainId: string;
        name: string;
    }[];
    balances?: SafeAppBalances | readonly SafeAppBalance[];
    chainInfo?: {
        chainName?: string;
        shortName?: string;
        nativeCurrency?: {
            name: string;
            symbol: string;
            decimals: number;
            logoUri?: string;
        };
        blockExplorerUriTemplate?: {
            address?: string;
            /** Safe Apps SDK / Safe Gateway field. */
            txHash?: string;
            /** Backward-compatible alias accepted by this harness and mapped to txHash. */
            tx?: string;
            api?: string;
        };
    };
    environmentOrigin?: string;
    /** Target used for Safe Apps multi-transaction batches. Defaults to Safe MultiSendCallOnly 1.4.1. */
    multiSendAddress?: Address;
    permissions?: readonly Record<string, unknown>[];
    proposer?: Address;
    safeInfo?: {
        implementation?: Address;
        modules?: readonly Address[] | null;
        fallbackHandler?: Address | null;
        guard?: Address | null;
        isReadOnly?: boolean;
        nonce?: number;
        version?: string | null;
    };
    version?: string;
};
export type SafeAppBalance = {
    tokenInfo: {
        type: string;
        address: string;
        decimals: number;
        symbol: string;
        name: string;
        logoUri: string | null;
    };
    balance: string;
    fiatBalance: string;
    fiatConversion: string;
};
export type SafeAppBalances = {
    fiatTotal: string;
    items: readonly SafeAppBalance[];
};
export declare const SAFE_MULTISEND_CALL_ONLY_ADDRESS: "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
export declare const SAFE_TRANSACTION_TYPED_DATA_TYPES: {
    readonly SafeTx: readonly [{
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "data";
        readonly type: "bytes";
    }, {
        readonly name: "operation";
        readonly type: "uint8";
    }, {
        readonly name: "safeTxGas";
        readonly type: "uint256";
    }, {
        readonly name: "baseGas";
        readonly type: "uint256";
    }, {
        readonly name: "gasPrice";
        readonly type: "uint256";
    }, {
        readonly name: "gasToken";
        readonly type: "address";
    }, {
        readonly name: "refundReceiver";
        readonly type: "address";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }];
};
export declare function normalizeSafeTransactionData(data: SafeTransactionData): NormalizedSafeTransactionData;
export declare function buildSafeTransactionTypedData(safeAddress: Address, chainId: number | bigint, data: SafeTransactionData): SafeTransactionTypedData;
/**
 * Safe protocol transaction hash, matching Safe.sol getTransactionHash:
 * EIP-712 domain { chainId, verifyingContract: safeAddress } and SafeTx.
 */
export declare function hashSafeTransactionTypedData(safeAddress: Address, chainId: number | bigint, data: SafeTransactionData): Hex;
/**
 * Deterministic local Safe transaction hash for tests and service fixtures.
 * Real Safe deployments should pass the protocol-computed safeTxHash.
 */
export declare function hashSafeTransactionData(safeAddress: Address, chainId: number | bigint, data: SafeTransactionData): Hex;
export declare function deterministicSafeSignature(safeTxHash: Hex, owner: Address): Hex;
export declare class SafeTransactionServiceClient implements SafeTransactionService {
    private readonly fetchImpl;
    private readonly baseUrl;
    private readonly apiPrefix;
    private readonly headers;
    private readonly chainId?;
    private readonly safeTxHashStrategy;
    constructor(options: SafeTransactionServiceClientOptions);
    proposeTransaction(proposal: SafeTransactionProposal): Promise<SafeMultisigTransaction>;
    confirmTransaction(safeTxHash: Hex, confirmation: SafeTransactionConfirmation): Promise<SafeMultisigTransaction>;
    getTransaction(safeTxHash: Hex): Promise<SafeMultisigTransaction>;
    listTransactions(safeAddress: Address): Promise<SafeMultisigTransaction[]>;
    listConfirmations(safeTxHash: Hex): Promise<SafeTransactionConfirmation[]>;
    private request;
    private hashSafeTransaction;
}
export declare class InMemorySafeTransactionService implements SafeTransactionService {
    private readonly transactions;
    proposeTransaction(proposal: SafeTransactionProposal): Promise<SafeMultisigTransaction>;
    confirmTransaction(safeTxHash: Hex, confirmation: SafeTransactionConfirmation): Promise<SafeMultisigTransaction>;
    getTransaction(safeTxHash: Hex): Promise<SafeMultisigTransaction>;
    listTransactions(safeAddress: Address): Promise<SafeMultisigTransaction[]>;
    listConfirmations(safeTxHash: Hex): Promise<SafeTransactionConfirmation[]>;
    markExecuted(safeTxHash: Hex, execution: {
        transactionHash: Hex;
        executorAddress: Address;
    }): Promise<SafeMultisigTransaction>;
    private mustGet;
}
export declare class SafeWalletHarness {
    readonly safeAddress: Address;
    readonly owners: readonly Address[];
    readonly threshold: number;
    readonly chainId: number | bigint;
    readonly transactionService: SafeTransactionService;
    private readonly rpcClient?;
    private readonly safeTxHashStrategy;
    private nonce;
    constructor(options: SafeWalletHarnessOptions);
    proposeTransaction(options: {
        transaction: Omit<SafeTransactionData, 'nonce'> & {
            nonce?: SafeTransactionData['nonce'];
        };
        proposer?: Address;
        signature?: Hex;
        origin?: string;
    }): Promise<SafeMultisigTransaction>;
    confirmTransaction(safeTxHash: Hex, options: {
        owner: Address;
        signature?: Hex;
    }): Promise<SafeMultisigTransaction>;
    executeTransaction(safeTxHash: Hex, options?: {
        executor?: Address;
    }): Promise<{
        txHash?: Hex;
        transaction: SafeMultisigTransaction;
    }>;
    getTransaction(safeTxHash: Hex): Promise<SafeMultisigTransaction>;
    listTransactions(): Promise<SafeMultisigTransaction[]>;
    listConfirmations(safeTxHash: Hex): Promise<SafeTransactionConfirmation[]>;
    get currentNonce(): bigint;
    requestRpc(request: JsonRpcRequest): Promise<unknown>;
    private nextNonce;
    private rollbackNonce;
    private hashSafeTransaction;
    private assertOwner;
}
export declare function handleSafeAppRequest(safe: SafeWalletHarness, request: SafeAppSdkRequest, options?: SafeAppBridgeOptions & {
    origin?: string;
}): Promise<unknown>;
export declare function injectSafeAppBridge(page: Page, safe: SafeWalletHarness, options?: SafeAppBridgeOptions): Promise<void>;
export declare function buildSafeAppBridgeScript(version?: string): string;
//# sourceMappingURL=safe.d.ts.map