import { type Address, type Chain, type Hex, type PublicActions, type TestClient, type Transport, type WalletActions } from 'viem';
import type { JsonRpcRequest, RpcClient } from './types.js';
export type AnvilOptions = {
    runtime?: 'binary' | 'docker';
    executable?: string;
    dockerImage?: string;
    containerName?: string;
    host?: string;
    port?: number;
    chainId?: number;
    accounts?: number;
    balance?: number;
    mnemonic?: string;
    blockTime?: number;
    forkUrl?: string;
    forkBlockNumber?: number;
    extraArgs?: readonly string[];
    timeoutMs?: number;
    silent?: boolean;
};
export type AnvilSnapshotId = Hex;
export type AnvilViemClient = TestClient<'anvil', Transport, Chain> & PublicActions<Transport, Chain> & WalletActions<Chain>;
export declare class AnvilInstance {
    private readonly process;
    private readonly containerName?;
    readonly host: string;
    readonly port: number;
    readonly chainId: number;
    readonly rpcUrl: string;
    private constructor();
    static start(options?: AnvilOptions): Promise<AnvilInstance>;
    stop(): Promise<void>;
    private reportedChainId;
}
export type ChainControllerOptions = {
    rpcUrl: string;
    chainId?: number;
};
export declare class ChainController implements RpcClient {
    readonly rpcUrl: string;
    readonly chainId: number;
    readonly client: AnvilViemClient;
    constructor(options: ChainControllerOptions);
    snapshot(): Promise<AnvilSnapshotId>;
    revert(id: AnvilSnapshotId): Promise<void>;
    accounts(): Promise<Address[]>;
    request(request: JsonRpcRequest): Promise<unknown>;
    impersonateAccount(address: Address): Promise<void>;
    stopImpersonatingAccount(address: Address): Promise<void>;
    setBalance(address: Address, value: bigint): Promise<void>;
    fastForward(seconds: number): Promise<void>;
    mine(blocks?: number): Promise<void>;
}
//# sourceMappingURL=anvil.d.ts.map