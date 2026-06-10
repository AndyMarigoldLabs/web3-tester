import { type Account, type Chain, type Hex } from 'viem';
import type { JsonRpcRequest, RpcClient } from './types.js';
export type PrivateKeyRpcClientOptions = {
    privateKey: Hex;
    chain?: Chain;
    rpcUrl?: string;
    /** Opt in to signing on production (non-testnet) chains. */
    allowMainnet?: boolean;
};
export declare class PrivateKeyRpcClient implements RpcClient {
    readonly account: Account;
    readonly chain: Chain;
    readonly sentTransactions: Hex[];
    readonly sentTransactionRequests: Array<{
        hash: Hex;
        to?: Hex;
        data?: Hex;
        value?: string;
    }>;
    private readonly publicClient;
    private readonly walletClient;
    private rpcChainVerified;
    constructor(options: PrivateKeyRpcClientOptions);
    request(request: JsonRpcRequest): Promise<unknown>;
    private assertRpcChainMatches;
}
//# sourceMappingURL=private-key-rpc-client.d.ts.map