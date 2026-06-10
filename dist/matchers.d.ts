import { type ExpectMatcherState } from '@playwright/test';
import { type Abi, type Address } from 'viem';
import { type ChainLike, type RevertTarget, type TransactionTarget } from './transactions.js';
type MatcherResult = {
    pass: boolean;
    message: () => string;
    expected?: unknown;
    actual?: unknown;
};
/** Named or positional; positional `undefined` = wildcard; values may be predicates. */
export type EventArgsExpectation = Record<string, unknown> | readonly unknown[];
export type EventMatchOptions = {
    args?: EventArgsExpectation;
    /** Restrict to events emitted by this contract. */
    address?: Address;
    /** Exact number of matching events; default passes on >= 1 (and `.not` asserts zero). */
    count?: number;
    timeout?: number;
};
export type BalanceChange = {
    address: Address;
    delta: bigint | number | string;
};
/** hardhat-chai-matchers `anyValue` parity for arg wildcards. */
export declare const anyValue: (_value: unknown) => boolean;
export declare const web3Matchers: {
    toEmitEvent(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, abi: Abi, eventName: string, options?: EventMatchOptions): Promise<MatcherResult>;
    toChangeBalance(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, address: Address, delta: bigint | number | string, options?: {
        includeFee?: boolean;
        timeout?: number;
    }): Promise<MatcherResult>;
    toChangeBalances(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, changes: readonly BalanceChange[], options?: {
        includeFee?: boolean;
        timeout?: number;
    }): Promise<MatcherResult>;
    toChangeTokenBalance(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, token: Address, address: Address, delta: bigint | number | string, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toChangeTokenBalances(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, token: Address, changes: readonly BalanceChange[], options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeReverted(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeRevertedWith(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, reason: string | RegExp, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeRevertedWithCustomError(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, abi: Abi, errorName: string, options?: {
        args?: readonly unknown[];
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeRevertedWithPanic(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, code?: bigint | number, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toHaveTokenBalance(this: ExpectMatcherState, holder: Address, chain: ChainLike, token: Address, expected: bigint | number | string | ((balance: bigint) => boolean)): Promise<MatcherResult>;
};
/** Pre-extended expect carrying every web3 matcher, fully typed. */
export declare const expect: import("@playwright/test").Expect<{
    toEmitEvent(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, abi: Abi, eventName: string, options?: EventMatchOptions): Promise<MatcherResult>;
    toChangeBalance(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, address: Address, delta: bigint | number | string, options?: {
        includeFee?: boolean;
        timeout?: number;
    }): Promise<MatcherResult>;
    toChangeBalances(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, changes: readonly BalanceChange[], options?: {
        includeFee?: boolean;
        timeout?: number;
    }): Promise<MatcherResult>;
    toChangeTokenBalance(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, token: Address, address: Address, delta: bigint | number | string, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toChangeTokenBalances(this: ExpectMatcherState, target: TransactionTarget, chain: ChainLike, token: Address, changes: readonly BalanceChange[], options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeReverted(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeRevertedWith(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, reason: string | RegExp, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeRevertedWithCustomError(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, abi: Abi, errorName: string, options?: {
        args?: readonly unknown[];
        timeout?: number;
    }): Promise<MatcherResult>;
    toBeRevertedWithPanic(this: ExpectMatcherState, target: RevertTarget, chain: ChainLike, code?: bigint | number, options?: {
        timeout?: number;
    }): Promise<MatcherResult>;
    toHaveTokenBalance(this: ExpectMatcherState, holder: Address, chain: ChainLike, token: Address, expected: bigint | number | string | ((balance: bigint) => boolean)): Promise<MatcherResult>;
}>;
export {};
//# sourceMappingURL=matchers.d.ts.map