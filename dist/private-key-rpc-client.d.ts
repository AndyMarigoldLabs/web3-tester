import { type AccessList, type Account, type Address, type Chain, type Hex } from 'viem';
import type { JsonRpcRequest, RpcClient } from './types.js';
export type PrivateKeyRpcClientOptions = {
    privateKey: Hex;
    chain?: Chain;
    rpcUrl?: string;
    /** Opt in to signing on production (non-testnet) chains. */
    allowMainnet?: boolean;
};
type KnownTransactionType = 'legacy' | 'eip2930' | 'eip1559' | 'eip4844' | 'eip7702';
export declare class PrivateKeyRpcClient implements RpcClient {
    readonly account: Account;
    readonly chain: Chain;
    readonly sentTransactions: Hex[];
    readonly sentTransactionRequests: Array<{
        accessList?: AccessList;
        from?: Address;
        gas?: string;
        gasPrice?: string;
        hash: Hex;
        maxFeePerBlobGas?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
        nonce?: number;
        to?: Address | null;
        data?: Hex;
        type?: KnownTransactionType;
        value?: string;
    }>;
    private readonly publicClient;
    private readonly walletClient;
    private rpcChainVerified;
    constructor(options: PrivateKeyRpcClientOptions);
    request(request: JsonRpcRequest): Promise<unknown>;
    /** Read-only viem public client backing this wallet (matchers, receipt waits). */
    get client(): {
        account: undefined;
        batch?: {
            multicall?: boolean | import("viem").Prettify<import("viem").MulticallBatchOptions> | undefined;
        } | undefined;
        cacheTime: number;
        ccipRead?: false | {
            request?: (parameters: import("viem").CcipRequestParameters) => Promise<`0x${string}`>;
        } | undefined;
        chain: Chain;
        dataSuffix?: import("viem").DataSuffix | undefined;
        experimental_blockTag?: import("viem").BlockTag | undefined;
        key: string;
        name: string;
        pollingInterval: number;
        request: import("viem").EIP1193RequestFn<import("viem").PublicRpcSchema>;
        transport: import("viem").TransportConfig<"http", import("viem").EIP1193RequestFn> & {
            fetchOptions?: import("viem").HttpTransportConfig["fetchOptions"] | undefined;
            url?: string | undefined;
        };
        type: string;
        uid: string;
        call: (parameters: import("viem").CallParameters<Chain>) => Promise<import("viem").CallReturnType>;
        createAccessList: (parameters: import("viem").CreateAccessListParameters<Chain>) => Promise<{
            accessList: AccessList;
            gasUsed: bigint;
        }>;
        createBlockFilter: () => Promise<import("viem").CreateBlockFilterReturnType>;
        createContractEventFilter: <const abi extends import("viem").Abi | readonly unknown[], eventName extends import("viem").ContractEventName<abi> | undefined, args extends import("viem").MaybeExtractEventArgsFromAbi<abi, eventName> | undefined, strict extends boolean | undefined = undefined, fromBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined, toBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined>(args: import("viem").CreateContractEventFilterParameters<abi, eventName, args, strict, fromBlock, toBlock>) => Promise<import("viem").CreateContractEventFilterReturnType<abi, eventName, args, strict, fromBlock, toBlock>>;
        createEventFilter: <const abiEvent extends import("viem").AbiEvent | undefined = undefined, const abiEvents extends readonly import("viem").AbiEvent[] | readonly unknown[] | undefined = abiEvent extends import("viem").AbiEvent ? [abiEvent] : undefined, strict extends boolean | undefined = undefined, fromBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined, toBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined, _EventName extends string | undefined = import("viem").MaybeAbiEventName<abiEvent>, _Args extends import("viem").MaybeExtractEventArgsFromAbi<abiEvents, _EventName> | undefined = undefined>(args?: import("viem").CreateEventFilterParameters<abiEvent, abiEvents, strict, fromBlock, toBlock, _EventName, _Args> | undefined) => Promise<import("viem").CreateEventFilterReturnType<abiEvent, abiEvents, strict, fromBlock, toBlock, _EventName, _Args>>;
        createPendingTransactionFilter: () => Promise<import("viem").CreatePendingTransactionFilterReturnType>;
        estimateContractGas: <chain extends Chain | undefined, const abi extends import("viem").Abi | readonly unknown[], functionName extends import("viem").ContractFunctionName<abi, "nonpayable" | "payable">, args extends import("viem").ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>>(args: import("viem").EstimateContractGasParameters<abi, functionName, args, chain>) => Promise<import("viem").EstimateContractGasReturnType>;
        estimateGas: (args: import("viem").EstimateGasParameters<Chain>) => Promise<import("viem").EstimateGasReturnType>;
        fillTransaction: <chainOverride extends Chain | undefined = undefined, accountOverride extends Account | Address | undefined = undefined>(args: import("viem").FillTransactionParameters<Chain, Account | undefined, chainOverride, accountOverride>) => Promise<import("viem").FillTransactionReturnType<Chain, chainOverride>>;
        getBalance: (args: import("viem").GetBalanceParameters) => Promise<import("viem").GetBalanceReturnType>;
        getBlobBaseFee: () => Promise<import("viem").GetBlobBaseFeeReturnType>;
        getBlock: <includeTransactions extends boolean = false, blockTag extends import("viem").BlockTag = "latest">(args?: import("viem").GetBlockParameters<includeTransactions, blockTag> | undefined) => Promise<{
            number: blockTag extends "pending" ? null : bigint;
            size: bigint;
            hash: blockTag extends "pending" ? null : `0x${string}`;
            nonce: blockTag extends "pending" ? null : `0x${string}`;
            logsBloom: blockTag extends "pending" ? null : `0x${string}`;
            baseFeePerGas: bigint | null;
            blobGasUsed: bigint;
            difficulty: bigint;
            excessBlobGas: bigint;
            extraData: Hex;
            gasLimit: bigint;
            gasUsed: bigint;
            miner: Address;
            mixHash: import("viem").Hash;
            parentBeaconBlockRoot?: `0x${string}` | undefined;
            parentHash: import("viem").Hash;
            receiptsRoot: Hex;
            sealFields: Hex[];
            sha3Uncles: import("viem").Hash;
            stateRoot: import("viem").Hash;
            timestamp: bigint;
            totalDifficulty: bigint | null;
            transactionsRoot: import("viem").Hash;
            uncles: import("viem").Hash[];
            withdrawals?: import("viem").Withdrawal[] | undefined | undefined;
            withdrawalsRoot?: `0x${string}` | undefined;
            transactions: includeTransactions extends true ? ({
                value: bigint;
                from: Address;
                to: Address | null;
                type: "legacy";
                blockTimestamp?: bigint | undefined;
                hash: import("viem").Hash;
                gas: bigint;
                chainId?: number | undefined;
                nonce: number;
                r: Hex;
                s: Hex;
                v: bigint;
                yParity?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice: bigint;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                input: Hex;
                typeHex: Hex | null;
                blockHash: (blockTag extends "pending" ? true : false) extends infer T ? T extends (blockTag extends "pending" ? true : false) ? T extends true ? null : `0x${string}` : never : never;
                blockNumber: (blockTag extends "pending" ? true : false) extends infer T_1 ? T_1 extends (blockTag extends "pending" ? true : false) ? T_1 extends true ? null : bigint : never : never;
                transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_2 ? T_2 extends (blockTag extends "pending" ? true : false) ? T_2 extends true ? null : number : never : never;
            } | {
                value: bigint;
                from: Address;
                to: Address | null;
                type: "eip2930";
                blockTimestamp?: bigint | undefined;
                hash: import("viem").Hash;
                gas: bigint;
                chainId: number;
                nonce: number;
                r: Hex;
                s: Hex;
                v: bigint;
                yParity: number;
                blobVersionedHashes?: undefined | undefined;
                gasPrice: bigint;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
                accessList: AccessList;
                authorizationList?: undefined | undefined;
                input: Hex;
                typeHex: Hex | null;
                blockHash: (blockTag extends "pending" ? true : false) extends infer T_3 ? T_3 extends (blockTag extends "pending" ? true : false) ? T_3 extends true ? null : `0x${string}` : never : never;
                blockNumber: (blockTag extends "pending" ? true : false) extends infer T_4 ? T_4 extends (blockTag extends "pending" ? true : false) ? T_4 extends true ? null : bigint : never : never;
                transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_5 ? T_5 extends (blockTag extends "pending" ? true : false) ? T_5 extends true ? null : number : never : never;
            } | {
                value: bigint;
                from: Address;
                to: Address | null;
                type: "eip1559";
                blockTimestamp?: bigint | undefined;
                hash: import("viem").Hash;
                gas: bigint;
                chainId: number;
                nonce: number;
                r: Hex;
                s: Hex;
                v: bigint;
                yParity: number;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas: bigint;
                maxPriorityFeePerGas: bigint;
                accessList: AccessList;
                authorizationList?: undefined | undefined;
                input: Hex;
                typeHex: Hex | null;
                blockHash: (blockTag extends "pending" ? true : false) extends infer T_6 ? T_6 extends (blockTag extends "pending" ? true : false) ? T_6 extends true ? null : `0x${string}` : never : never;
                blockNumber: (blockTag extends "pending" ? true : false) extends infer T_7 ? T_7 extends (blockTag extends "pending" ? true : false) ? T_7 extends true ? null : bigint : never : never;
                transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_8 ? T_8 extends (blockTag extends "pending" ? true : false) ? T_8 extends true ? null : number : never : never;
            } | {
                value: bigint;
                from: Address;
                to: Address | null;
                type: "eip4844";
                blockTimestamp?: bigint | undefined;
                hash: import("viem").Hash;
                gas: bigint;
                chainId: number;
                nonce: number;
                r: Hex;
                s: Hex;
                v: bigint;
                yParity: number;
                blobVersionedHashes: readonly Hex[];
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas: bigint;
                maxFeePerGas: bigint;
                maxPriorityFeePerGas: bigint;
                accessList: AccessList;
                authorizationList?: undefined | undefined;
                input: Hex;
                typeHex: Hex | null;
                blockHash: (blockTag extends "pending" ? true : false) extends infer T_9 ? T_9 extends (blockTag extends "pending" ? true : false) ? T_9 extends true ? null : `0x${string}` : never : never;
                blockNumber: (blockTag extends "pending" ? true : false) extends infer T_10 ? T_10 extends (blockTag extends "pending" ? true : false) ? T_10 extends true ? null : bigint : never : never;
                transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_11 ? T_11 extends (blockTag extends "pending" ? true : false) ? T_11 extends true ? null : number : never : never;
            } | {
                value: bigint;
                from: Address;
                to: Address | null;
                type: "eip7702";
                blockTimestamp?: bigint | undefined;
                hash: import("viem").Hash;
                gas: bigint;
                chainId: number;
                nonce: number;
                r: Hex;
                s: Hex;
                v: bigint;
                yParity: number;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas: bigint;
                maxPriorityFeePerGas: bigint;
                accessList: AccessList;
                authorizationList: import("viem").SignedAuthorizationList;
                input: Hex;
                typeHex: Hex | null;
                blockHash: (blockTag extends "pending" ? true : false) extends infer T_12 ? T_12 extends (blockTag extends "pending" ? true : false) ? T_12 extends true ? null : `0x${string}` : never : never;
                blockNumber: (blockTag extends "pending" ? true : false) extends infer T_13 ? T_13 extends (blockTag extends "pending" ? true : false) ? T_13 extends true ? null : bigint : never : never;
                transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_14 ? T_14 extends (blockTag extends "pending" ? true : false) ? T_14 extends true ? null : number : never : never;
            })[] : `0x${string}`[];
        }>;
        getBlockReceipts: (args?: import("viem").GetBlockReceiptsParameters | undefined) => Promise<import("viem").GetBlockReceiptsReturnType<Chain>>;
        getBlockNumber: (args?: import("viem").GetBlockNumberParameters | undefined) => Promise<import("viem").GetBlockNumberReturnType>;
        getBlockTransactionCount: (args?: import("viem").GetBlockTransactionCountParameters | undefined) => Promise<import("viem").GetBlockTransactionCountReturnType>;
        getBytecode: (args: import("viem").GetBytecodeParameters) => Promise<import("viem").GetBytecodeReturnType>;
        getChainId: () => Promise<import("viem").GetChainIdReturnType>;
        getCode: (args: import("viem").GetBytecodeParameters) => Promise<import("viem").GetBytecodeReturnType>;
        getContractEvents: <const abi extends import("viem").Abi | readonly unknown[], eventName extends import("viem").ContractEventName<abi> | undefined = undefined, strict extends boolean | undefined = undefined, fromBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined, toBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined>(args: import("viem").GetContractEventsParameters<abi, eventName, strict, fromBlock, toBlock>) => Promise<import("viem").GetContractEventsReturnType<abi, eventName, strict, fromBlock, toBlock>>;
        getDelegation: (args: import("viem").GetDelegationParameters) => Promise<import("viem").GetDelegationReturnType>;
        getEip712Domain: (args: import("viem").GetEip712DomainParameters) => Promise<import("viem").GetEip712DomainReturnType>;
        getEnsAddress: (args: import("viem").GetEnsAddressParameters) => Promise<import("viem").GetEnsAddressReturnType>;
        getEnsAvatar: (args: import("viem").GetEnsAvatarParameters) => Promise<import("viem").GetEnsAvatarReturnType>;
        getEnsName: (args: import("viem").GetEnsNameParameters) => Promise<import("viem").GetEnsNameReturnType>;
        getEnsResolver: (args: import("viem").GetEnsResolverParameters) => Promise<import("viem").GetEnsResolverReturnType>;
        getEnsText: (args: import("viem").GetEnsTextParameters) => Promise<import("viem").GetEnsTextReturnType>;
        getFeeHistory: (args: import("viem").GetFeeHistoryParameters) => Promise<import("viem").GetFeeHistoryReturnType>;
        estimateFeesPerGas: <chainOverride extends Chain | undefined = undefined, type extends import("viem").FeeValuesType = "eip1559">(args?: import("viem").EstimateFeesPerGasParameters<Chain, chainOverride, type> | undefined) => Promise<import("viem").EstimateFeesPerGasReturnType<type>>;
        getFilterChanges: <filterType extends import("viem").FilterType, const abi extends import("viem").Abi | readonly unknown[] | undefined, eventName extends string | undefined, strict extends boolean | undefined = undefined, fromBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined, toBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined>(args: import("viem").GetFilterChangesParameters<filterType, abi, eventName, strict, fromBlock, toBlock>) => Promise<import("viem").GetFilterChangesReturnType<filterType, abi, eventName, strict, fromBlock, toBlock>>;
        getFilterLogs: <const abi extends import("viem").Abi | readonly unknown[] | undefined, eventName extends string | undefined, strict extends boolean | undefined = undefined, fromBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined, toBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined>(args: import("viem").GetFilterLogsParameters<abi, eventName, strict, fromBlock, toBlock>) => Promise<import("viem").GetFilterLogsReturnType<abi, eventName, strict, fromBlock, toBlock>>;
        getGasPrice: () => Promise<import("viem").GetGasPriceReturnType>;
        getLogs: <const abiEvent extends import("viem").AbiEvent | undefined = undefined, const abiEvents extends readonly import("viem").AbiEvent[] | readonly unknown[] | undefined = abiEvent extends import("viem").AbiEvent ? [abiEvent] : undefined, strict extends boolean | undefined = undefined, fromBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined, toBlock extends import("viem").BlockNumber | import("viem").BlockTag | undefined = undefined>(args?: import("viem").GetLogsParameters<abiEvent, abiEvents, strict, fromBlock, toBlock> | undefined) => Promise<import("viem").GetLogsReturnType<abiEvent, abiEvents, strict, fromBlock, toBlock>>;
        getProof: (args: import("viem").GetProofParameters) => Promise<import("viem").GetProofReturnType>;
        estimateMaxPriorityFeePerGas: <chainOverride extends Chain | undefined = undefined>(args?: {
            chain?: chainOverride | null | undefined;
        } | undefined) => Promise<import("viem").EstimateMaxPriorityFeePerGasReturnType>;
        getStorageAt: (args: import("viem").GetStorageAtParameters) => Promise<import("viem").GetStorageAtReturnType>;
        getTransaction: <blockTag extends import("viem").BlockTag = "latest">(args: import("viem").GetTransactionParameters<blockTag>) => Promise<{
            value: bigint;
            from: Address;
            to: Address | null;
            type: "legacy";
            blockTimestamp?: bigint | undefined;
            hash: import("viem").Hash;
            gas: bigint;
            chainId?: number | undefined;
            nonce: number;
            r: Hex;
            s: Hex;
            v: bigint;
            yParity?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice: bigint;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            input: Hex;
            typeHex: Hex | null;
            blockHash: (blockTag extends "pending" ? true : false) extends infer T ? T extends (blockTag extends "pending" ? true : false) ? T extends true ? null : `0x${string}` : never : never;
            blockNumber: (blockTag extends "pending" ? true : false) extends infer T_1 ? T_1 extends (blockTag extends "pending" ? true : false) ? T_1 extends true ? null : bigint : never : never;
            transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_2 ? T_2 extends (blockTag extends "pending" ? true : false) ? T_2 extends true ? null : number : never : never;
        } | {
            value: bigint;
            from: Address;
            to: Address | null;
            type: "eip2930";
            blockTimestamp?: bigint | undefined;
            hash: import("viem").Hash;
            gas: bigint;
            chainId: number;
            nonce: number;
            r: Hex;
            s: Hex;
            v: bigint;
            yParity: number;
            blobVersionedHashes?: undefined | undefined;
            gasPrice: bigint;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
            accessList: AccessList;
            authorizationList?: undefined | undefined;
            input: Hex;
            typeHex: Hex | null;
            blockHash: (blockTag extends "pending" ? true : false) extends infer T_3 ? T_3 extends (blockTag extends "pending" ? true : false) ? T_3 extends true ? null : `0x${string}` : never : never;
            blockNumber: (blockTag extends "pending" ? true : false) extends infer T_4 ? T_4 extends (blockTag extends "pending" ? true : false) ? T_4 extends true ? null : bigint : never : never;
            transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_5 ? T_5 extends (blockTag extends "pending" ? true : false) ? T_5 extends true ? null : number : never : never;
        } | {
            value: bigint;
            from: Address;
            to: Address | null;
            type: "eip1559";
            blockTimestamp?: bigint | undefined;
            hash: import("viem").Hash;
            gas: bigint;
            chainId: number;
            nonce: number;
            r: Hex;
            s: Hex;
            v: bigint;
            yParity: number;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas: bigint;
            maxPriorityFeePerGas: bigint;
            accessList: AccessList;
            authorizationList?: undefined | undefined;
            input: Hex;
            typeHex: Hex | null;
            blockHash: (blockTag extends "pending" ? true : false) extends infer T_6 ? T_6 extends (blockTag extends "pending" ? true : false) ? T_6 extends true ? null : `0x${string}` : never : never;
            blockNumber: (blockTag extends "pending" ? true : false) extends infer T_7 ? T_7 extends (blockTag extends "pending" ? true : false) ? T_7 extends true ? null : bigint : never : never;
            transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_8 ? T_8 extends (blockTag extends "pending" ? true : false) ? T_8 extends true ? null : number : never : never;
        } | {
            value: bigint;
            from: Address;
            to: Address | null;
            type: "eip4844";
            blockTimestamp?: bigint | undefined;
            hash: import("viem").Hash;
            gas: bigint;
            chainId: number;
            nonce: number;
            r: Hex;
            s: Hex;
            v: bigint;
            yParity: number;
            blobVersionedHashes: readonly Hex[];
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas: bigint;
            maxFeePerGas: bigint;
            maxPriorityFeePerGas: bigint;
            accessList: AccessList;
            authorizationList?: undefined | undefined;
            input: Hex;
            typeHex: Hex | null;
            blockHash: (blockTag extends "pending" ? true : false) extends infer T_9 ? T_9 extends (blockTag extends "pending" ? true : false) ? T_9 extends true ? null : `0x${string}` : never : never;
            blockNumber: (blockTag extends "pending" ? true : false) extends infer T_10 ? T_10 extends (blockTag extends "pending" ? true : false) ? T_10 extends true ? null : bigint : never : never;
            transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_11 ? T_11 extends (blockTag extends "pending" ? true : false) ? T_11 extends true ? null : number : never : never;
        } | {
            value: bigint;
            from: Address;
            to: Address | null;
            type: "eip7702";
            blockTimestamp?: bigint | undefined;
            hash: import("viem").Hash;
            gas: bigint;
            chainId: number;
            nonce: number;
            r: Hex;
            s: Hex;
            v: bigint;
            yParity: number;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas: bigint;
            maxPriorityFeePerGas: bigint;
            accessList: AccessList;
            authorizationList: import("viem").SignedAuthorizationList;
            input: Hex;
            typeHex: Hex | null;
            blockHash: (blockTag extends "pending" ? true : false) extends infer T_12 ? T_12 extends (blockTag extends "pending" ? true : false) ? T_12 extends true ? null : `0x${string}` : never : never;
            blockNumber: (blockTag extends "pending" ? true : false) extends infer T_13 ? T_13 extends (blockTag extends "pending" ? true : false) ? T_13 extends true ? null : bigint : never : never;
            transactionIndex: (blockTag extends "pending" ? true : false) extends infer T_14 ? T_14 extends (blockTag extends "pending" ? true : false) ? T_14 extends true ? null : number : never : never;
        }>;
        getTransactionConfirmations: (args: import("viem").GetTransactionConfirmationsParameters<Chain>) => Promise<import("viem").GetTransactionConfirmationsReturnType>;
        getTransactionCount: (args: import("viem").GetTransactionCountParameters) => Promise<import("viem").GetTransactionCountReturnType>;
        getTransactionReceipt: (args: import("viem").GetTransactionReceiptParameters) => Promise<import("viem").TransactionReceipt>;
        multicall: <const contracts extends readonly unknown[], allowFailure extends boolean = true>(args: import("viem").MulticallParameters<contracts, allowFailure>) => Promise<import("viem").MulticallReturnType<contracts, allowFailure>>;
        prepareTransactionRequest: <const request extends import("viem").PrepareTransactionRequestRequest<Chain, chainOverride>, chainOverride extends Chain | undefined = undefined, accountOverride extends Account | Address | undefined = undefined>(args: import("viem").PrepareTransactionRequestParameters<Chain, Account | undefined, chainOverride, accountOverride, request>) => Promise<import("viem").UnionRequiredBy<Extract<import("viem").UnionOmit<import("viem").ExtractChainFormatterParameters<import("viem").DeriveChain<Chain, chainOverride>, "transactionRequest", import("viem").TransactionRequest>, "from"> & (import("viem").DeriveChain<Chain, chainOverride> extends infer T_1 ? T_1 extends import("viem").DeriveChain<Chain, chainOverride> ? T_1 extends Chain ? {
            chain: T_1;
        } : {
            chain?: undefined;
        } : never : never) & (import("viem").DeriveAccount<Account | undefined, accountOverride> extends infer T_2 ? T_2 extends import("viem").DeriveAccount<Account | undefined, accountOverride> ? T_2 extends Account ? {
            account: T_2;
            from: Address;
        } : {
            account?: undefined;
            from?: undefined;
        } : never : never), import("viem").IsNever<import("viem").ExtractFormattedTransactionRequest<import("viem").DeriveChain<Chain, chainOverride>, {
            type?: ((request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) extends infer T_3 ? T_3 extends (request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) ? T_3 extends string ? T_3 : undefined : never : never) | undefined;
        }, import("viem").UnionOmit<import("viem").ExtractChainFormatterParameters<import("viem").DeriveChain<Chain, chainOverride>, "transactionRequest", import("viem").TransactionRequest>, "from">, ((request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) extends infer T_4 ? T_4 extends (request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) ? T_4 extends string ? T_4 : undefined : never : never) | undefined>> extends true ? unknown : import("viem").ExactPartial<import("viem").ExtractFormattedTransactionRequest<import("viem").DeriveChain<Chain, chainOverride>, {
            type?: ((request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) extends infer T_5 ? T_5 extends (request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
                accessList?: undefined | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } & (import("viem").OneOf<{
                maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
            } | {
                maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
            }, import("viem").FeeValuesEIP1559> & {
                accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
            }) ? "eip1559" : never) | (request extends {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: bigint | undefined;
                sidecars?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: undefined | undefined;
                maxPriorityFeePerGas?: undefined | undefined;
            } & {
                accessList: import("viem").TransactionSerializableEIP2930["accessList"];
            } ? "eip2930" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: undefined | undefined;
                blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
                blobVersionedHashes?: readonly `0x${string}`[] | undefined;
                maxFeePerBlobGas?: bigint | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
            }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
                blobs: import("viem").TransactionSerializableEIP4844["blobs"];
            } | {
                blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
            } | {
                sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
            }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            } | {
                accessList?: AccessList | undefined;
                authorizationList?: import("viem").SignedAuthorizationList | undefined;
                blobs?: undefined | undefined;
                blobVersionedHashes?: undefined | undefined;
                gasPrice?: undefined | undefined;
                maxFeePerBlobGas?: undefined | undefined;
                maxFeePerGas?: bigint | undefined;
                maxPriorityFeePerGas?: bigint | undefined;
                sidecars?: undefined | undefined;
            }) & {
                authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
            } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) ? T_5 extends string ? T_5 : undefined : never : never) | undefined;
        }, import("viem").UnionOmit<import("viem").ExtractChainFormatterParameters<import("viem").DeriveChain<Chain, chainOverride>, "transactionRequest", import("viem").TransactionRequest>, "from">, ((request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) extends infer T_6 ? T_6 extends (request["type"] extends string | undefined ? request["type"] : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : import("viem").GetTransactionType<request, (request extends {
            accessList?: undefined | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & import("viem").FeeValuesLegacy ? "legacy" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } & (import("viem").OneOf<{
            maxFeePerGas: import("viem").FeeValuesEIP1559["maxFeePerGas"];
        } | {
            maxPriorityFeePerGas: import("viem").FeeValuesEIP1559["maxPriorityFeePerGas"];
        }, import("viem").FeeValuesEIP1559> & {
            accessList?: import("viem").TransactionSerializableEIP2930["accessList"] | undefined;
        }) ? "eip1559" : never) | (request extends {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: bigint | undefined;
            sidecars?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: undefined | undefined;
            maxPriorityFeePerGas?: undefined | undefined;
        } & {
            accessList: import("viem").TransactionSerializableEIP2930["accessList"];
        } ? "eip2930" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: undefined | undefined;
            blobs?: readonly `0x${string}`[] | readonly import("viem").ByteArray[] | undefined;
            blobVersionedHashes?: readonly `0x${string}`[] | undefined;
            maxFeePerBlobGas?: bigint | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: false | readonly import("viem").BlobSidecar<`0x${string}`>[] | undefined;
        }) & (import("viem").ExactPartial<import("viem").FeeValuesEIP4844> & import("viem").OneOf<{
            blobs: import("viem").TransactionSerializableEIP4844["blobs"];
        } | {
            blobVersionedHashes: import("viem").TransactionSerializableEIP4844["blobVersionedHashes"];
        } | {
            sidecars: import("viem").TransactionSerializableEIP4844["sidecars"];
        }, import("viem").TransactionSerializableEIP4844>) ? "eip4844" : never) | (request extends ({
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        } | {
            accessList?: AccessList | undefined;
            authorizationList?: import("viem").SignedAuthorizationList | undefined;
            blobs?: undefined | undefined;
            blobVersionedHashes?: undefined | undefined;
            gasPrice?: undefined | undefined;
            maxFeePerBlobGas?: undefined | undefined;
            maxFeePerGas?: bigint | undefined;
            maxPriorityFeePerGas?: bigint | undefined;
            sidecars?: undefined | undefined;
        }) & {
            authorizationList: import("viem").TransactionSerializableEIP7702["authorizationList"];
        } ? "eip7702" : never) | (request["type"] extends string | undefined ? Extract<request["type"], string> : never)>) ? T_6 extends string ? T_6 : undefined : never : never) | undefined>>> & {
            chainId?: number | undefined;
        }, (request["parameters"] extends readonly import("viem").PrepareTransactionRequestParameterType[] ? request["parameters"][number] : "type" | "gas" | "chainId" | "nonce" | "blobVersionedHashes" | "fees") extends infer T_7 ? T_7 extends (request["parameters"] extends readonly import("viem").PrepareTransactionRequestParameterType[] ? request["parameters"][number] : "type" | "gas" | "chainId" | "nonce" | "blobVersionedHashes" | "fees") ? T_7 extends "fees" ? "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas" : T_7 : never : never> & (unknown extends request["kzg"] ? {} : Pick<request, "kzg">) & {
            _capabilities?: {
                [x: string]: any;
            } | undefined;
        } extends infer T ? { [K in keyof T]: T[K]; } : never>;
        readContract: <const abi extends import("viem").Abi | readonly unknown[], functionName extends import("viem").ContractFunctionName<abi, "pure" | "view">, const args extends import("viem").ContractFunctionArgs<abi, "pure" | "view", functionName>>(args: import("viem").ReadContractParameters<abi, functionName, args>) => Promise<import("viem").ReadContractReturnType<abi, functionName, args>>;
        sendRawTransaction: (args: import("viem").SendRawTransactionParameters) => Promise<import("viem").SendRawTransactionReturnType>;
        sendRawTransactionSync: (args: import("viem").SendRawTransactionSyncParameters) => Promise<import("viem").TransactionReceipt>;
        simulate: <const calls extends readonly unknown[]>(args: import("viem").SimulateBlocksParameters<calls>) => Promise<import("viem").SimulateBlocksReturnType<calls>>;
        simulateBlocks: <const calls extends readonly unknown[]>(args: import("viem").SimulateBlocksParameters<calls>) => Promise<import("viem").SimulateBlocksReturnType<calls>>;
        simulateCalls: <const calls extends readonly unknown[]>(args: import("viem").SimulateCallsParameters<calls>) => Promise<import("viem").SimulateCallsReturnType<calls>>;
        simulateContract: <const abi extends import("viem").Abi | readonly unknown[], functionName extends import("viem").ContractFunctionName<abi, "nonpayable" | "payable">, const args_1 extends import("viem").ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>, chainOverride extends Chain | undefined, accountOverride extends Account | Address | undefined = undefined>(args: import("viem").SimulateContractParameters<abi, functionName, args_1, Chain, chainOverride, accountOverride>) => Promise<import("viem").SimulateContractReturnType<abi, functionName, args_1, Chain, Account | undefined, chainOverride, accountOverride>>;
        verifyHash: (args: import("viem").VerifyHashActionParameters) => Promise<import("viem").VerifyHashActionReturnType>;
        verifyMessage: (args: import("viem").VerifyMessageActionParameters) => Promise<import("viem").VerifyMessageActionReturnType>;
        verifySiweMessage: (args: {
            blockNumber?: bigint | undefined | undefined;
            blockTag?: import("viem").BlockTag | undefined;
            address?: `0x${string}` | undefined;
            nonce?: string | undefined | undefined;
            domain?: string | undefined | undefined;
            scheme?: string | undefined | undefined;
            time?: Date | undefined;
            message: string;
            signature: Hex;
        }) => Promise<boolean>;
        verifyTypedData: (args: import("viem").VerifyTypedDataActionParameters) => Promise<import("viem").VerifyTypedDataActionReturnType>;
        uninstallFilter: (args: import("viem").UninstallFilterParameters) => Promise<import("viem").UninstallFilterReturnType>;
        waitForTransactionReceipt: (args: import("viem").WaitForTransactionReceiptParameters<Chain>) => Promise<import("viem").TransactionReceipt>;
        watchBlockNumber: (args: import("viem").WatchBlockNumberParameters) => import("viem").WatchBlockNumberReturnType;
        watchBlocks: <includeTransactions extends boolean = false, blockTag extends import("viem").BlockTag = "latest">(args: import("viem").WatchBlocksParameters<import("viem").HttpTransport<undefined, false>, Chain, includeTransactions, blockTag>) => import("viem").WatchBlocksReturnType;
        watchContractEvent: <const abi extends import("viem").Abi | readonly unknown[], eventName extends import("viem").ContractEventName<abi>, strict extends boolean | undefined = undefined>(args: import("viem").WatchContractEventParameters<abi, eventName, strict, import("viem").HttpTransport<undefined, false>>) => import("viem").WatchContractEventReturnType;
        watchEvent: <const abiEvent extends import("viem").AbiEvent | undefined = undefined, const abiEvents extends readonly import("viem").AbiEvent[] | readonly unknown[] | undefined = abiEvent extends import("viem").AbiEvent ? [abiEvent] : undefined, strict extends boolean | undefined = undefined>(args: import("viem").WatchEventParameters<abiEvent, abiEvents, strict, import("viem").HttpTransport<undefined, false>>) => import("viem").WatchEventReturnType;
        watchPendingTransactions: (args: import("viem").WatchPendingTransactionsParameters<import("viem").HttpTransport<undefined, false>>) => import("viem").WatchPendingTransactionsReturnType;
        extend: <const client extends {
            [x: string]: unknown;
            account?: undefined;
            batch?: undefined;
            cacheTime?: undefined;
            ccipRead?: undefined;
            chain?: undefined;
            dataSuffix?: undefined;
            experimental_blockTag?: undefined;
            key?: undefined;
            name?: undefined;
            pollingInterval?: undefined;
            request?: undefined;
            transport?: undefined;
            type?: undefined;
            uid?: undefined;
        } & import("viem").ExactPartial<Pick<import("viem").PublicActions<import("viem").HttpTransport<undefined, false>, Chain, undefined>, "prepareTransactionRequest" | "call" | "createContractEventFilter" | "createEventFilter" | "estimateContractGas" | "estimateGas" | "getBlock" | "getBlockNumber" | "getChainId" | "getContractEvents" | "getEnsText" | "getFilterChanges" | "getGasPrice" | "getLogs" | "getTransaction" | "getTransactionCount" | "getTransactionReceipt" | "readContract" | "sendRawTransaction" | "simulateContract" | "uninstallFilter" | "watchBlockNumber" | "watchContractEvent"> & Pick<import("viem").WalletActions<Chain, undefined>, "sendTransaction" | "writeContract">>>(fn: (client: import("viem").Client<import("viem").HttpTransport<undefined, false>, Chain, undefined, import("viem").PublicRpcSchema, import("viem").PublicActions<import("viem").HttpTransport<undefined, false>, Chain>>) => client) => import("viem").Client<import("viem").HttpTransport<undefined, false>, Chain, undefined, import("viem").PublicRpcSchema, { [K in keyof client]: client[K]; } & import("viem").PublicActions<import("viem").HttpTransport<undefined, false>, Chain>>;
    };
    /** Signs an EIP-7702 authorization with this client's local account. */
    signAuthorization(options: {
        contractAddress: Hex;
        chainId?: number;
        nonce?: number;
        executor?: 'self';
    }): Promise<import("viem").SignAuthorizationReturnType>;
    private assertRpcChainMatches;
    private toSendTransactionRequest;
}
export {};
//# sourceMappingURL=private-key-rpc-client.d.ts.map