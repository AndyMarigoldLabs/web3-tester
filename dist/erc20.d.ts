import { type Address } from 'viem';
import type { RpcClient } from './types.js';
export { TEST_ERC20_ABI, TEST_ERC20_BYTECODE, TEST_ERC20_SOLC_VERSION, TEST_ERC20_SOURCE_SHA256, } from './contracts/test-erc20.js';
export type Erc20StorageLayout = 'solidity' | 'vyper';
export type Erc20SlotInfo = {
    layout: Erc20StorageLayout;
    /** Mapping base slot: a small integer, or an ERC-7201 namespace root. */
    balanceSlot: bigint;
    /** Discovered lazily on first adjustTotalSupply use. */
    totalSupplySlot?: bigint;
};
export type DealErc20Options = {
    /** forge-std deal(token,to,give,adjust) parity: shift totalSupply by the balance delta. Default false. */
    adjustTotalSupply?: boolean;
    /** Highest integer mapping base slot probed per layout. Default 64. */
    maxSlot?: number;
    /** Skip discovery with a known mapping base slot. */
    slot?: bigint | number;
    /** Layout used with `slot`. Default 'solidity'. */
    layout?: Erc20StorageLayout;
    /** Contract whose storage holds balances when it differs from `token`. */
    storageAddress?: Address;
};
export declare class Erc20DealError extends Error {
    readonly token: Address;
    /** Candidate slots tried across both layouts. */
    readonly probedSlots: number;
    constructor(message: string, token: Address, 
    /** Candidate slots tried across both layouts. */
    probedSlots: number);
}
export declare function discoverErc20BalanceSlot(client: RpcClient, token: Address, holder: Address, options?: {
    maxSlot?: number;
    storageAddress?: Address;
}): Promise<Erc20SlotInfo>;
export declare function getErc20Balance(client: RpcClient, token: Address, account: Address): Promise<bigint>;
export declare function dealErc20(client: RpcClient, token: Address, account: Address, amount: bigint, options?: DealErc20Options, cache?: Map<string, Erc20SlotInfo>): Promise<void>;
//# sourceMappingURL=erc20.d.ts.map