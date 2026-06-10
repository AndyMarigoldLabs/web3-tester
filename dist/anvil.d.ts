import { type Abi, type Address, type Chain, type Hex, type PublicActions, type TestClient, type TransactionReceipt, type Transport, type WalletActions } from 'viem';
import { TEST_ERC20_ABI } from './contracts/test-erc20.js';
import { type DealErc20Options } from './erc20.js';
import type { JsonRpcRequest, RpcClient } from './types.js';
export type DeployContractOptions = {
    abi: Abi;
    bytecode: Hex;
    args?: readonly unknown[];
    /** Defaults to the first Anvil unlocked account. */
    from?: Address;
    value?: bigint;
};
export type DeployedContract = {
    address: Address;
    hash: Hex;
    receipt: TransactionReceipt;
};
export type DeployErc20Options = {
    name?: string;
    symbol?: string;
    decimals?: number;
    /** Minted to mintTo in the constructor. Default 0n. */
    initialSupply?: bigint;
    /** Defaults to the deployer. */
    mintTo?: Address;
    from?: Address;
};
export type DeployedErc20 = DeployedContract & {
    abi: typeof TEST_ERC20_ABI;
    name: string;
    symbol: string;
    decimals: number;
};
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
    /** Opt in to binding Anvil to a non-loopback interface. */
    allowNonLoopbackHost?: boolean;
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
    private readonly erc20SlotCache;
    deployContract(options: DeployContractOptions): Promise<DeployedContract>;
    deployErc20(options?: DeployErc20Options): Promise<DeployedErc20>;
    /** forge-std deal parity: set any standard ERC-20 balance, fork included. */
    dealErc20(token: Address, account: Address, amount: bigint, options?: DealErc20Options): Promise<void>;
    getErc20Balance(token: Address, account: Address): Promise<bigint>;
    setStorageAt(address: Address, slot: Hex | bigint | number, value: Hex | bigint): Promise<void>;
    setCode(address: Address, bytecode: Hex): Promise<void>;
    setNonce(address: Address, nonce: number): Promise<void>;
}
//# sourceMappingURL=anvil.d.ts.map