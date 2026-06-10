import {
  expect as baseExpect,
  type ExpectMatcherState,
} from '@playwright/test';
import { erc20Abi, parseEventLogs, type Abi, type Address, type Hex } from 'viem';
import {
  describePanic,
  extractRevertInfo,
  isWalletRejectionError,
  recoverRevertInfo,
  renderRevertInfo,
  resolveClient,
  resolveTxHash,
  web3Equals,
  web3Stringify,
  type ChainLike,
  type ReadClient,
  type RevertInfo,
  type RevertTarget,
  type TransactionTarget,
} from './transactions.js';

type MatcherResult = { pass: boolean; message: () => string; expected?: unknown; actual?: unknown };

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
export type BalanceChange = { address: Address; delta: bigint | number | string };

/** hardhat-chai-matchers `anyValue` parity for arg wildcards. */
export const anyValue = (_value: unknown): boolean => true;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

const toBigInt = (value: bigint | number | string): bigint =>
  typeof value === 'bigint' ? value : BigInt(value);

const badReceiver = (state: ExpectMatcherState, name: string, received: unknown): MatcherResult => ({
  pass: false,
  message: () =>
    `${state.utils.matcherHint(name, undefined, undefined, { isNot: state.isNot })}\n\n` +
    `Received value is not a transaction hash (or { hash }): ${web3Stringify(received)}`,
});

const eventArgsMatch = (
  logArgs: unknown,
  expectation: EventArgsExpectation,
  abi: Abi,
  eventName: string,
): boolean => {
  if (Array.isArray(expectation)) {
    const positional: unknown[] = Array.isArray(logArgs)
      ? [...(logArgs as unknown[])]
      : (() => {
          const event = abi.find(
            (entry) => entry.type === 'event' && 'name' in entry && entry.name === eventName,
          ) as { inputs?: readonly { name?: string }[] } | undefined;
          return (event?.inputs ?? []).map((input, index) =>
            input.name
              ? (logArgs as Record<string, unknown>)[input.name]
              : (logArgs as Record<string, unknown>)[index],
          );
        })();
    return expectation.every(
      (expected, index) => expected === undefined || web3Equals(expected, positional[index]),
    );
  }

  const named = (logArgs ?? {}) as Record<string, unknown>;
  return Object.entries(expectation).every(([key, expected]) => web3Equals(expected, named[key]));
};

// Resolves a revert-family receiver into a uniform shape; wallet approval
// failures are rethrown with a hint instead of counting as reverts.
const resolveRevertReceiver = async (
  target: RevertTarget,
  client: ReadClient,
  timeout: number | undefined,
  abi: Abi | undefined,
): Promise<
  | { outcome: 'reverted'; info: RevertInfo; gasUsed?: bigint }
  | { outcome: 'succeeded'; detail: string }
> => {
  let resolved: unknown;
  try {
    resolved = typeof target === 'function' ? await (target as () => Promise<unknown>)() : await target;
  } catch (error) {
    if (isWalletRejectionError(error)) {
      throw new Error(
        `The wallet rejected the request — a wallet approval failure, not a chain revert: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    const info = extractRevertInfo(error, abi);
    if (!info) {
      throw new Error(
        `The call rejected with a non-revert error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    return { outcome: 'reverted', info };
  }

  const hash = await resolveTxHash(resolved);
  if (!hash) {
    return {
      outcome: 'succeeded',
      detail: `the call succeeded and resolved to ${web3Stringify(resolved)}`,
    };
  }

  const receipt = await client.waitForTransactionReceipt({ hash, timeout });
  if (receipt.status === 'success') {
    return {
      outcome: 'succeeded',
      detail: `transaction ${hash} succeeded (gasUsed ${receipt.gasUsed})`,
    };
  }
  return {
    outcome: 'reverted',
    info: await recoverRevertInfo(client, hash, receipt, abi),
    gasUsed: receipt.gasUsed,
  };
};

const balanceChangeMatcher = async (
  state: ExpectMatcherState,
  name: string,
  target: TransactionTarget,
  chain: ChainLike,
  changes: readonly BalanceChange[],
  options: { includeFee?: boolean; timeout?: number },
  readBalance: (
    client: ReadClient,
    address: Address,
    blockNumber: bigint,
  ) => Promise<bigint>,
  feeAdjustable: boolean,
): Promise<MatcherResult> => {
  const client = resolveClient(chain);
  const hash = await resolveTxHash(target);
  if (!hash) {
    return badReceiver(state, name, await target);
  }

  const receipt = await client.waitForTransactionReceipt({
    hash,
    timeout: options.timeout ?? state.timeout,
  });

  const observed: Array<{ address: Address; expected: bigint; actual: bigint }> = [];
  for (const change of changes) {
    const after = await readBalance(client, change.address, receipt.blockNumber);
    const before = await readBalance(client, change.address, receipt.blockNumber - 1n);
    let delta = after - before;
    // hardhat parity: the sender's gas fee is excluded unless includeFee.
    if (
      feeAdjustable &&
      !options.includeFee &&
      change.address.toLowerCase() === receipt.from.toLowerCase()
    ) {
      delta += receipt.gasUsed * receipt.effectiveGasPrice;
    }
    observed.push({ address: change.address, expected: toBigInt(change.delta), actual: delta });
  }

  const pass = observed.every((entry) => entry.expected === entry.actual);
  const message = async () => {
    const lines = observed.map(
      (entry) =>
        `  ${entry.address}: expected ${entry.expected}, observed ${entry.actual}${
          entry.expected === entry.actual ? '' : '  ←'
        }`,
    );
    const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => undefined);
    const crowded =
      block && block.transactions.length > 1
        ? `\n${block.transactions.length - 1} other transaction(s) share this block and may also have moved balances.`
        : '';
    return (
      `${state.utils.matcherHint(name, undefined, undefined, { isNot: state.isNot })}\n\n` +
      `Transaction ${hash} (block ${receipt.blockNumber}):\n${lines.join('\n')}${crowded}`
    );
  };
  const rendered = await message();
  return {
    pass,
    message: () => rendered,
    expected: observed.map((entry) => `${entry.address}: ${entry.expected}`),
    actual: observed.map((entry) => `${entry.address}: ${entry.actual}`),
  };
};

const erc20Balance = (token: Address) =>
  async (client: ReadClient, address: Address, blockNumber: bigint): Promise<bigint> =>
    (await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      blockNumber,
    })) as bigint;

export const web3Matchers = {
  async toEmitEvent(
    this: ExpectMatcherState,
    target: TransactionTarget,
    chain: ChainLike,
    abi: Abi,
    eventName: string,
    options: EventMatchOptions = {},
  ): Promise<MatcherResult> {
    const client = resolveClient(chain);
    const hash = await resolveTxHash(target);
    if (!hash) {
      return badReceiver(this, 'toEmitEvent', await target);
    }

    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: options.timeout ?? this.timeout,
    });

    const decoded = parseEventLogs({ abi, logs: receipt.logs, strict: false });
    // parseEventLogs silently drops foreign-topic0 logs; surface them by diff.
    const decodedIndexes = new Set(decoded.map((log) => log.logIndex));
    const undecodable = receipt.logs.filter((log) => !decodedIndexes.has(log.logIndex));

    let candidates = decoded.filter((log) => log.eventName === eventName);
    if (options.address) {
      candidates = candidates.filter(
        (log) => log.address.toLowerCase() === options.address!.toLowerCase(),
      );
    }
    const matching =
      options.args === undefined
        ? candidates
        : candidates.filter((log) => eventArgsMatch(log.args, options.args!, abi, eventName));

    const pass =
      options.count !== undefined ? matching.length === options.count : matching.length >= 1;

    const emitted = decoded.map(
      (log) => `  ${log.eventName}(${web3Stringify(log.args).replace(/\n\s*/g, ' ')}) @ ${log.address}`,
    );
    const extras = undecodable.map((log) => `  <undecodable> topic0=${log.topics[0]} @ ${log.address}`);
    const revertedNote =
      receipt.status !== 'success'
        ? '\nThe transaction REVERTED — reverted transactions emit no events.'
        : '';

    return {
      pass,
      message: () =>
        `${this.utils.matcherHint('toEmitEvent', undefined, eventName, { isNot: this.isNot })}\n\n` +
        `Expected ${options.count !== undefined ? `exactly ${options.count}` : 'at least one'} ` +
        `"${eventName}" event${options.args ? ` with args ${web3Stringify(options.args)}` : ''}; ` +
        `found ${matching.length}.${revertedNote}\n` +
        `Events in receipt:\n${[...emitted, ...extras].join('\n') || '  (none)'}`,
      expected: options.args,
      actual: candidates.map((log) => log.args),
    };
  },

  async toChangeBalance(
    this: ExpectMatcherState,
    target: TransactionTarget,
    chain: ChainLike,
    address: Address,
    delta: bigint | number | string,
    options: { includeFee?: boolean; timeout?: number } = {},
  ): Promise<MatcherResult> {
    return balanceChangeMatcher(
      this,
      'toChangeBalance',
      target,
      chain,
      [{ address, delta }],
      options,
      (client, holder, blockNumber) => client.getBalance({ address: holder, blockNumber }),
      true,
    );
  },

  async toChangeBalances(
    this: ExpectMatcherState,
    target: TransactionTarget,
    chain: ChainLike,
    changes: readonly BalanceChange[],
    options: { includeFee?: boolean; timeout?: number } = {},
  ): Promise<MatcherResult> {
    return balanceChangeMatcher(
      this,
      'toChangeBalances',
      target,
      chain,
      changes,
      options,
      (client, holder, blockNumber) => client.getBalance({ address: holder, blockNumber }),
      true,
    );
  },

  async toChangeTokenBalance(
    this: ExpectMatcherState,
    target: TransactionTarget,
    chain: ChainLike,
    token: Address,
    address: Address,
    delta: bigint | number | string,
    options: { timeout?: number } = {},
  ): Promise<MatcherResult> {
    return balanceChangeMatcher(
      this,
      'toChangeTokenBalance',
      target,
      chain,
      [{ address, delta }],
      options,
      erc20Balance(token),
      false,
    );
  },

  async toChangeTokenBalances(
    this: ExpectMatcherState,
    target: TransactionTarget,
    chain: ChainLike,
    token: Address,
    changes: readonly BalanceChange[],
    options: { timeout?: number } = {},
  ): Promise<MatcherResult> {
    return balanceChangeMatcher(
      this,
      'toChangeTokenBalances',
      target,
      chain,
      changes,
      options,
      erc20Balance(token),
      false,
    );
  },

  async toBeReverted(
    this: ExpectMatcherState,
    target: RevertTarget,
    chain: ChainLike,
    options: { timeout?: number } = {},
  ): Promise<MatcherResult> {
    const result = await resolveRevertReceiver(
      target,
      resolveClient(chain),
      options.timeout ?? this.timeout,
      undefined,
    );
    return {
      pass: result.outcome === 'reverted',
      message: () =>
        `${this.utils.matcherHint('toBeReverted', undefined, undefined, { isNot: this.isNot })}\n\n` +
        (result.outcome === 'reverted'
          ? `Reverted with ${renderRevertInfo(result.info)}.`
          : `Expected a revert, but ${result.detail}.`),
    };
  },

  async toBeRevertedWith(
    this: ExpectMatcherState,
    target: RevertTarget,
    chain: ChainLike,
    reason: string | RegExp,
    options: { timeout?: number } = {},
  ): Promise<MatcherResult> {
    const result = await resolveRevertReceiver(
      target,
      resolveClient(chain),
      options.timeout ?? this.timeout,
      undefined,
    );

    let pass = false;
    let detail: string;
    if (result.outcome === 'succeeded') {
      detail = `Expected a revert, but ${result.detail}.`;
    } else if (result.info.kind === 'reason') {
      pass =
        typeof reason === 'string' ? result.info.reason === reason : reason.test(result.info.reason);
      detail = `Reverted with Error("${result.info.reason}").`;
    } else {
      detail = `Reverted, but not with an Error(string): ${renderRevertInfo(result.info)}.`;
    }

    return {
      pass,
      message: () =>
        `${this.utils.matcherHint('toBeRevertedWith', undefined, String(reason), { isNot: this.isNot })}\n\n${detail}`,
      expected: String(reason),
      actual: result.outcome === 'reverted' ? renderRevertInfo(result.info) : 'success',
    };
  },

  async toBeRevertedWithCustomError(
    this: ExpectMatcherState,
    target: RevertTarget,
    chain: ChainLike,
    abi: Abi,
    errorName: string,
    options: { args?: readonly unknown[]; timeout?: number } = {},
  ): Promise<MatcherResult> {
    const result = await resolveRevertReceiver(
      target,
      resolveClient(chain),
      options.timeout ?? this.timeout,
      abi,
    );

    let pass = false;
    let detail: string;
    if (result.outcome === 'succeeded') {
      detail = `Expected a revert, but ${result.detail}.`;
    } else if (result.info.kind === 'custom') {
      pass =
        result.info.errorName === errorName &&
        (options.args === undefined ||
          web3Equals([...options.args], [...(result.info.args ?? [])]));
      detail = `Reverted with ${renderRevertInfo(result.info)}.`;
    } else {
      detail = `Reverted, but not with a custom error: ${renderRevertInfo(result.info)}.`;
    }

    return {
      pass,
      message: () =>
        `${this.utils.matcherHint('toBeRevertedWithCustomError', undefined, errorName, { isNot: this.isNot })}\n\n${detail}`,
      expected: `${errorName}(${(options.args ?? []).map(String).join(', ')})`,
      actual: result.outcome === 'reverted' ? renderRevertInfo(result.info) : 'success',
    };
  },

  async toBeRevertedWithPanic(
    this: ExpectMatcherState,
    target: RevertTarget,
    chain: ChainLike,
    code?: bigint | number,
    options: { timeout?: number } = {},
  ): Promise<MatcherResult> {
    const result = await resolveRevertReceiver(
      target,
      resolveClient(chain),
      options.timeout ?? this.timeout,
      undefined,
    );

    let pass = false;
    let detail: string;
    if (result.outcome === 'succeeded') {
      detail = `Expected a panic, but ${result.detail}.`;
    } else if (result.info.kind === 'panic') {
      pass = code === undefined || BigInt(code) === result.info.code;
      detail = `Reverted with ${renderRevertInfo(result.info)}.`;
    } else {
      detail = `Reverted, but not with a Panic: ${renderRevertInfo(result.info)}.`;
    }

    return {
      pass,
      message: () =>
        `${this.utils.matcherHint('toBeRevertedWithPanic', undefined, code === undefined ? '' : `0x${BigInt(code).toString(16)} (${describePanic(BigInt(code))})`, { isNot: this.isNot })}\n\n${detail}`,
    };
  },

  async toHaveTokenBalance(
    this: ExpectMatcherState,
    holder: Address,
    chain: ChainLike,
    token: Address,
    expected: bigint | number | string | ((balance: bigint) => boolean),
  ): Promise<MatcherResult> {
    // Address and tx-hash are both `0x${string}` — catch 32-byte receivers.
    if (typeof holder !== 'string' || !ADDRESS_PATTERN.test(holder)) {
      return {
        pass: false,
        message: () =>
          `${this.utils.matcherHint('toHaveTokenBalance', undefined, undefined, { isNot: this.isNot })}\n\n` +
          `Received value is not a 20-byte address: ${web3Stringify(holder)}`,
      };
    }

    const client = resolveClient(chain);
    const balance = (await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder],
    })) as bigint;

    const pass =
      typeof expected === 'function' ? Boolean(expected(balance)) : toBigInt(expected) === balance;

    return {
      pass,
      message: () =>
        `${this.utils.matcherHint('toHaveTokenBalance', undefined, undefined, { isNot: this.isNot })}\n\n` +
        `Token ${token} balance of ${holder}: ${balance}` +
        (typeof expected === 'function' ? ' (predicate)' : `, expected ${toBigInt(expected)}`),
      expected: typeof expected === 'function' ? 'predicate' : toBigInt(expected).toString(),
      actual: balance.toString(),
    };
  },
};

/** Pre-extended expect carrying every web3 matcher, fully typed. */
export const expect = baseExpect.extend(web3Matchers);
