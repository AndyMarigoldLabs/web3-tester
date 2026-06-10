import { type Abi, type Address, type Hex, type Log, type TransactionReceipt } from 'viem';
/**
 * Anything the matchers can read a chain through. ChainController (via its
 * `client`), PrivateKeyRpcClient (via the `client` getter), or a bare viem
 * PublicClient all satisfy it structurally.
 */
export type ReadClient = {
    getTransactionReceipt(args: {
        hash: Hex;
    }): Promise<TransactionReceipt>;
    waitForTransactionReceipt(args: {
        hash: Hex;
        timeout?: number;
    }): Promise<TransactionReceipt>;
    getTransaction(args: {
        hash: Hex;
    }): Promise<{
        from: Address;
        to: Address | null;
        input: Hex;
        value: bigint;
        gas: bigint;
    }>;
    getBalance(args: {
        address: Address;
        blockNumber?: bigint;
    }): Promise<bigint>;
    readContract(args: {
        address: Address;
        abi: Abi;
        functionName: string;
        args?: readonly unknown[];
        blockNumber?: bigint;
    }): Promise<unknown>;
    call(args: Record<string, unknown>): Promise<unknown>;
    getBlock(args: {
        blockNumber: bigint;
    }): Promise<{
        transactions: readonly Hex[];
    }>;
    /** Raw JSON-RPC escape hatch (viem clients have it) — used for tracing. */
    request?(args: {
        method: string;
        params?: unknown;
    }): Promise<unknown>;
};
/** ChainController fits the second arm. */
export type ChainLike = ReadClient | {
    client: ReadClient;
};
/** SentTransactionRecord fits { hash }. */
export type TransactionRef = Hex | {
    hash: Hex;
};
/** waitForNextTransaction() fits. */
export type TransactionTarget = TransactionRef | Promise<TransactionRef>;
export type RevertTarget = TransactionTarget | Promise<unknown> | (() => Promise<unknown>);
export type RevertInfo = {
    kind: 'reason';
    reason: string;
    data: Hex;
} | {
    kind: 'panic';
    code: bigint;
    description: string;
    data: Hex;
} | {
    kind: 'custom';
    errorName: string;
    args?: readonly unknown[];
    selector: Hex;
    data: Hex;
} | {
    kind: 'unknown';
    data?: Hex;
    message?: string;
};
export type DecodedTransaction = {
    receipt: TransactionReceipt;
    status: 'success' | 'reverted';
    logs: (Log & {
        eventName: string;
        args: unknown;
    })[];
    revertReason?: string;
    revertInfo?: RevertInfo;
};
export declare const resolveClient: (chain: ChainLike) => ReadClient;
/** Returns the 32-byte hash, or undefined when the target is not tx-shaped. */
export declare const resolveTxHash: (target: unknown) => Promise<Hex | undefined>;
export declare const describePanic: (code: bigint) => string;
export declare const decodeRevertData: (data: Hex, abi?: Abi) => RevertInfo;
/**
 * Wallet approval failures (deny-by-default gating, simulateRejection,
 * origin scoping). Detection is by message text: EIP-1193 error codes do not
 * survive Playwright's page.evaluate error serialization.
 */
export declare const isWalletRejectionError: (error: unknown) => boolean;
/**
 * Walks an error's cause chain for revert data: viem's
 * ContractFunctionRevertedError (`raw`), RpcRequestError (`data`), nested
 * `.data.data`, and finally "execution reverted: …" message text.
 */
export declare const extractRevertInfo: (error: unknown, abi?: Abi) => RevertInfo | undefined;
export declare const recoverRevertInfo: (client: ReadClient, hash: Hex, receipt: TransactionReceipt, abi?: Abi) => Promise<RevertInfo>;
export declare function waitForDecodedTransaction(client: ReadClient, hash: Hex, options?: {
    abi?: Abi;
    timeoutMs?: number;
}): Promise<DecodedTransaction>;
/** JSON stringifier that renders bigints as `123n`. */
export declare const web3Stringify: (value: unknown) => string;
/**
 * Matcher equality: predicates apply, bigint-vs-number/decimal-string
 * coerces, 0x-strings compare case-insensitively, arrays compare item-wise.
 */
export declare const web3Equals: (expected: unknown, actual: unknown) => boolean;
export declare const renderRevertInfo: (info: RevertInfo | undefined) => string;
//# sourceMappingURL=transactions.d.ts.map