import { type Account, type Chain, type Hex } from 'viem';
import type { JsonRpcRequest, RpcClient } from './types.js';
export type PrivateKeyRpcClientOptions = {
    privateKey: Hex;
    chain?: Chain;
    rpcUrl?: string;
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
    constructor(options: PrivateKeyRpcClientOptions);
    request(request: JsonRpcRequest): Promise<unknown>;
}
//# sourceMappingURL=private-key-rpc-client.d.ts.map