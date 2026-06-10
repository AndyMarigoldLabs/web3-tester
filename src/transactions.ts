import {
  decodeErrorResult,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from 'viem';

/**
 * Anything the matchers can read a chain through. ChainController (via its
 * `client`), PrivateKeyRpcClient (via the `client` getter), or a bare viem
 * PublicClient all satisfy it structurally.
 */
export type ReadClient = {
  getTransactionReceipt(args: { hash: Hex }): Promise<TransactionReceipt>;
  waitForTransactionReceipt(args: { hash: Hex; timeout?: number }): Promise<TransactionReceipt>;
  getTransaction(args: {
    hash: Hex;
  }): Promise<{ from: Address; to: Address | null; input: Hex; value: bigint; gas: bigint }>;
  getBalance(args: { address: Address; blockNumber?: bigint }): Promise<bigint>;
  readContract(args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<unknown>;
  call(args: Record<string, unknown>): Promise<unknown>;
  getBlock(args: { blockNumber: bigint }): Promise<{ transactions: readonly Hex[] }>;
  /** Raw JSON-RPC escape hatch (viem clients have it) — used for tracing. */
  request?(args: { method: string; params?: unknown }): Promise<unknown>;
};

/** ChainController fits the second arm. */
export type ChainLike = ReadClient | { client: ReadClient };

/** SentTransactionRecord fits { hash }. */
export type TransactionRef = Hex | { hash: Hex };
/** waitForNextTransaction() fits. */
export type TransactionTarget = TransactionRef | Promise<TransactionRef>;
export type RevertTarget = TransactionTarget | Promise<unknown> | (() => Promise<unknown>);

export type RevertInfo =
  | { kind: 'reason'; reason: string; data: Hex }
  | { kind: 'panic'; code: bigint; description: string; data: Hex }
  | { kind: 'custom'; errorName: string; args?: readonly unknown[]; selector: Hex; data: Hex }
  | { kind: 'unknown'; data?: Hex; message?: string };

export type DecodedTransaction = {
  receipt: TransactionReceipt;
  status: 'success' | 'reverted';
  logs: (Log & { eventName: string; args: unknown })[];
  revertReason?: string;
  revertInfo?: RevertInfo;
};

export const resolveClient = (chain: ChainLike): ReadClient =>
  'client' in chain ? (chain as { client: ReadClient }).client : (chain as ReadClient);

const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/i;

/** Returns the 32-byte hash, or undefined when the target is not tx-shaped. */
export const resolveTxHash = async (target: unknown): Promise<Hex | undefined> => {
  const resolved = await target;
  const hash =
    typeof resolved === 'string'
      ? resolved
      : resolved && typeof resolved === 'object' && 'hash' in resolved
        ? (resolved as { hash: unknown }).hash
        : undefined;
  return typeof hash === 'string' && TX_HASH_PATTERN.test(hash) ? (hash as Hex) : undefined;
};

const PANIC_DESCRIPTIONS: Record<number, string> = {
  0x00: 'generic compiler panic',
  0x01: 'assertion failed',
  0x11: 'arithmetic overflow or underflow',
  0x12: 'division or modulo by zero',
  0x21: 'invalid enum value',
  0x22: 'invalid storage byte array encoding',
  0x31: 'pop on an empty array',
  0x32: 'array index out of bounds',
  0x41: 'allocation of too much memory',
  0x51: 'call to an uninitialized internal function',
};

export const describePanic = (code: bigint): string =>
  PANIC_DESCRIPTIONS[Number(code)] ?? 'unknown panic code';

const isRevertDataHex = (value: unknown): value is Hex =>
  typeof value === 'string' && /^0x[0-9a-f]*$/i.test(value) && value.length >= 10;

// decodeErrorResult appends the built-in Error(string)/Panic(uint256) ABIs,
// so reasons and panics decode even without a user abi.
export const decodeRevertData = (data: Hex, abi?: Abi): RevertInfo => {
  try {
    const decoded = decodeErrorResult({ abi: abi ?? [], data });
    if (decoded.errorName === 'Error') {
      return { kind: 'reason', reason: String(decoded.args?.[0] ?? ''), data };
    }
    if (decoded.errorName === 'Panic') {
      const code = decoded.args?.[0] as bigint;
      return { kind: 'panic', code, description: describePanic(code), data };
    }
    return {
      kind: 'custom',
      errorName: decoded.errorName,
      args: decoded.args,
      selector: data.slice(0, 10) as Hex,
      data,
    };
  } catch {
    return { kind: 'unknown', data };
  }
};

/**
 * Wallet approval failures (deny-by-default gating, simulateRejection,
 * origin scoping). Detection is by message text: EIP-1193 error codes do not
 * survive Playwright's page.evaluate error serialization.
 */
export const isWalletRejectionError = (error: unknown): boolean => {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /user rejected the request|has not been authorized by the user|wallet is not available to origin/i.test(
    message,
  );
};

/**
 * Walks an error's cause chain for revert data: viem's
 * ContractFunctionRevertedError (`raw`), RpcRequestError (`data`), nested
 * `.data.data`, and finally "execution reverted: …" message text.
 */
export const extractRevertInfo = (error: unknown, abi?: Abi): RevertInfo | undefined => {
  let current: unknown = error;
  const seen = new Set<unknown>();
  let messageInfo: RevertInfo | undefined;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const err = current as Record<string, unknown>;

    if (isRevertDataHex(err.raw)) {
      return decodeRevertData(err.raw, abi);
    }
    if (isRevertDataHex(err.data)) {
      return decodeRevertData(err.data, abi);
    }
    const nested = (err.data as Record<string, unknown> | null | undefined)?.data;
    if (isRevertDataHex(nested)) {
      return decodeRevertData(nested, abi);
    }

    if (!messageInfo && typeof err.message === 'string') {
      const reason =
        err.message.match(/reverted with reason string '([^']*)'/i)?.[1] ??
        err.message.match(/execution reverted:\s*([^\n]+)/i)?.[1];
      if (reason !== undefined) {
        messageInfo = { kind: 'reason', reason: reason.trim(), data: '0x' };
      } else if (/execution reverted|reverted/i.test(err.message)) {
        messageInfo = { kind: 'unknown', message: err.message };
      }
    }

    current = (current as { cause?: unknown }).cause;
  }

  return messageInfo;
};

// Reason recovery for a MINED reverted transaction: replay the call at the
// parent block (exact under automine where each tx is alone in its block),
// then fall back to debug_traceTransaction, which is immune to multi-tx
// blocks and block-env-dependent reverts.
export const recoverRevertInfo = async (
  client: ReadClient,
  hash: Hex,
  receipt: TransactionReceipt,
  abi?: Abi,
): Promise<RevertInfo> => {
  try {
    const transaction = await client.getTransaction({ hash });
    await client.call({
      account: transaction.from,
      to: transaction.to ?? undefined,
      data: transaction.input,
      value: transaction.value,
      gas: transaction.gas,
      blockNumber: receipt.blockNumber - 1n,
    });
    // The replay unexpectedly succeeded (state divergence) — fall through.
  } catch (error) {
    const info = extractRevertInfo(error, abi);
    if (info) {
      return info;
    }
  }

  try {
    const trace = (await client.request?.({
      method: 'debug_traceTransaction',
      params: [hash, { tracer: 'callTracer' }],
    })) as { output?: unknown } | undefined;
    if (trace && isRevertDataHex(trace.output)) {
      return decodeRevertData(trace.output, abi);
    }
  } catch {
    // Tracing unavailable — report unknown below.
  }

  return {
    kind: 'unknown',
    message:
      'the transaction reverted but the reason could not be recovered (multi-transaction block or pruned state?)',
  };
};

export async function waitForDecodedTransaction(
  client: ReadClient,
  hash: Hex,
  options: { abi?: Abi; timeoutMs?: number } = {},
): Promise<DecodedTransaction> {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: options.timeoutMs });
  const status = receipt.status === 'success' ? 'success' : 'reverted';

  const logs = options.abi
    ? (parseEventLogs({
        abi: options.abi,
        logs: receipt.logs,
        strict: false,
      }) as DecodedTransaction['logs'])
    : [];

  let revertInfo: RevertInfo | undefined;
  if (status === 'reverted') {
    revertInfo = await recoverRevertInfo(client, hash, receipt, options.abi);
  }

  return {
    receipt,
    status,
    logs,
    revertInfo,
    revertReason: revertInfo?.kind === 'reason' ? revertInfo.reason : undefined,
  };
}

/** JSON stringifier that renders bigints as `123n`. */
export const web3Stringify = (value: unknown): string => {
  const rendered = JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item),
    2,
  );
  return rendered ?? String(value);
};

/**
 * Matcher equality: predicates apply, bigint-vs-number/decimal-string
 * coerces, 0x-strings compare case-insensitively, arrays compare item-wise.
 */
export const web3Equals = (expected: unknown, actual: unknown): boolean => {
  if (typeof expected === 'function') {
    return Boolean((expected as (value: unknown) => boolean)(actual));
  }
  if (typeof actual === 'bigint' && (typeof expected === 'number' || typeof expected === 'string')) {
    try {
      return BigInt(expected) === actual;
    } catch {
      return false;
    }
  }
  if (
    typeof expected === 'string' &&
    typeof actual === 'string' &&
    expected.startsWith('0x') &&
    actual.startsWith('0x')
  ) {
    return expected.toLowerCase() === actual.toLowerCase();
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return (
      expected.length === actual.length &&
      expected.every((item, index) => web3Equals(item, actual[index]))
    );
  }
  return Object.is(expected, actual);
};

export const renderRevertInfo = (info: RevertInfo | undefined): string => {
  if (!info) {
    return 'no revert information';
  }
  switch (info.kind) {
    case 'reason':
      return `Error("${info.reason}")`;
    case 'panic':
      return `Panic(0x${info.code.toString(16)}) — ${info.description}`;
    case 'custom':
      return `${info.errorName}(${(info.args ?? []).map((arg) => String(arg)).join(', ')}) [selector ${info.selector}]`;
    case 'unknown':
      return info.message ?? `undecodable revert data ${info.data ?? ''}`.trim();
  }
};
