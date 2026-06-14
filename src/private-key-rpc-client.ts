import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type AccessList,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { providerError } from './errors.js';
import type { JsonRpcRequest, RpcClient } from './types.js';

export type PrivateKeyRpcClientOptions = {
  privateKey: Hex;
  chain?: Chain;
  rpcUrl?: string;
  /** Opt in to signing on production (non-testnet) chains. */
  allowMainnet?: boolean;
};

// Anvil/Hardhat chains are safe targets but viem does not mark them
// `testnet: true`, so they need their own allowlist entry.
const LOCAL_DEV_CHAIN_IDS = new Set([1337, 31337]);

const isTestChain = (chain: Chain): boolean =>
  chain.testnet === true || LOCAL_DEV_CHAIN_IDS.has(chain.id);

const normalizePrivateKey = (privateKey: string): Hex => {
  const trimmed = privateKey.trim();
  return trimmed.startsWith('0x') ? (trimmed as Hex) : (`0x${trimmed}` as Hex);
};

const asHex = (value: unknown): Hex | undefined =>
  typeof value === 'string' && value.startsWith('0x') ? (value as Hex) : undefined;

// Hex payloads must be signed as raw bytes: decoding to UTF-8 first corrupts
// binary messages (TextDecoder substitutes U+FFFD instead of throwing), and for
// valid UTF-8 text the EIP-191 digest over the raw bytes is identical anyway.
const normalizeMessage = (message: unknown): string | { raw: Hex } => {
  const hex = asHex(message);
  return hex ? { raw: hex } : String(message ?? '');
};

const parseParams = (request: JsonRpcRequest): unknown[] =>
  Array.isArray(request.params) ? [...request.params] : [];

type KnownTransactionType = 'legacy' | 'eip2930' | 'eip1559' | 'eip4844' | 'eip7702';

type ParsedSendTransactionRequest = {
  account: Account;
  accessList?: AccessList;
  authorizationList?: ReturnType<typeof parseAuthorizationList>;
  blobVersionedHashes?: readonly Hex[];
  blobs?: readonly Hex[];
  chain: Chain;
  data?: Hex;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerBlobGas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  to?: Address | null;
  type?: KnownTransactionType;
  value?: bigint;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseAddressField = (value: unknown, field: string): Address | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && isAddress(value)) return value;
  throw new Error(`${field} must be a valid address.`);
};

const parseNullableAddressField = (value: unknown, field: string): Address | null | undefined => {
  if (value === null) return null;
  return parseAddressField(value, field);
};

const parseHexField = (value: unknown, field: string): Hex | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.startsWith('0x')) return value as Hex;
  throw new Error(`${field} must be a 0x-prefixed hex string.`);
};

const parseHexArrayField = (value: unknown, field: string): readonly Hex[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  return value.map((entry, index) => {
    if (typeof entry === 'string' && entry.startsWith('0x')) return entry as Hex;
    throw new Error(`${field}[${index}] must be a 0x-prefixed hex string.`);
  });
};

const parseQuantity = (value: unknown, field: string): bigint | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string') {
    try {
      return BigInt(value);
    } catch {
      // Fall through to the shared error below.
    }
  }
  throw new Error(`${field} must be a non-negative integer, bigint, decimal string, or 0x-hex quantity.`);
};

const parseIndex = (value: unknown, field: string): number | undefined => {
  const quantity = parseQuantity(value, field);
  if (quantity === undefined) return undefined;
  const parsed = Number(quantity);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} is too large to fit in a JavaScript number.`);
  return parsed;
};

const parseChainId = (value: unknown): number | undefined => parseIndex(value, 'chainId');

const transactionTypeAliases: Record<string, KnownTransactionType> = {
  '0x0': 'legacy',
  '0x1': 'eip2930',
  '0x2': 'eip1559',
  '0x3': 'eip4844',
  '0x4': 'eip7702',
  legacy: 'legacy',
  eip2930: 'eip2930',
  eip1559: 'eip1559',
  eip4844: 'eip4844',
  eip7702: 'eip7702',
};

const parseTransactionType = (value: unknown): KnownTransactionType | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('type must be a transaction type string.');
  const normalized = value.toLowerCase();
  const type = transactionTypeAliases[normalized];
  if (!type) {
    throw new Error(
      `Unsupported transaction type "${value}". Expected legacy/eip2930/eip1559/eip4844/eip7702 or 0x0-0x4.`,
    );
  }
  return type;
};

const parseAccessList = (value: unknown): AccessList | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('accessList must be an array.');
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`accessList[${index}] must be an object.`);
    const address = parseAddressField(entry.address, `accessList[${index}].address`);
    if (!address) throw new Error(`accessList[${index}].address is required.`);
    const storageKeys = parseHexArrayField(entry.storageKeys, `accessList[${index}].storageKeys`);
    return {
      address,
      storageKeys: storageKeys ?? [],
    };
  });
};

// Dapp-supplied authorization entries are RPC-shaped (hex chainId/nonce/
// yParity) while viem's sendTransaction expects numbers — a silent
// passthrough would RLP-encode garbage, so malformed entries fail loudly.
const parseAuthorizationList = (
  value: unknown,
): Array<{ address: Hex; chainId: number; nonce: number; r: Hex; s: Hex; yParity: number }> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error('authorizationList must be an array.');
  }

  return value.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const address = (item.address ?? item.contractAddress) as unknown;
    if (typeof address !== 'string' || !address.startsWith('0x')) {
      throw new Error(`authorizationList[${index}] needs an address.`);
    }

    const toNumber = (raw: unknown, name: string): number => {
      if (typeof raw === 'number') {
        return raw;
      }
      if (typeof raw === 'string' && raw.startsWith('0x')) {
        return Number(BigInt(raw));
      }
      throw new Error(`authorizationList[${index}].${name} must be a number or 0x-hex string.`);
    };

    return {
      address: address as Hex,
      chainId: toNumber(item.chainId, 'chainId'),
      nonce: toNumber(item.nonce, 'nonce'),
      r: item.r as Hex,
      s: item.s as Hex,
      yParity: toNumber(item.yParity ?? 0, 'yParity'),
    };
  });
};

export class PrivateKeyRpcClient implements RpcClient {
  readonly account: Account;
  readonly chain: Chain;
  readonly sentTransactions: Hex[] = [];
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
  }> = [];

  private readonly publicClient;
  private readonly walletClient: WalletClient;
  private rpcChainVerified = false;

  constructor(options: PrivateKeyRpcClientOptions) {
    this.chain = options.chain ?? sepolia;
    if (!options.allowMainnet && !isTestChain(this.chain)) {
      throw new Error(
        `PrivateKeyRpcClient refuses chain "${this.chain.name}" (id ${this.chain.id}) because it is not marked as a testnet. ` +
          'This client signs and broadcasts without confirmation prompts. Pass allowMainnet: true to target a production chain, ' +
          'or use a chain definition with testnet: true.',
      );
    }
    this.account = privateKeyToAccount(normalizePrivateKey(options.privateKey));

    const transport = http(options.rpcUrl);
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport,
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport,
    });
  }

  async request(request: JsonRpcRequest): Promise<unknown> {
    const params = parseParams(request);

    switch (request.method) {
      // Answered locally: the client holds exactly one key, and remote RPC
      // nodes answer [] (a needless network roundtrip that would also blind
      // MockWalletController's account validation in live mode).
      case 'eth_accounts':
        return [this.account.address];

      case 'personal_sign': {
        // Standard order is [message, address]; some legacy callers send
        // [address, message]. When both params are addresses the request is
        // ambiguous, so prefer the standard order and treat the first as the
        // message.
        const [first, second] = params;
        const firstIsAddress = typeof first === 'string' && isAddress(first);
        const secondIsAddress = typeof second === 'string' && isAddress(second);
        const message =
          firstIsAddress && !secondIsAddress && second !== undefined ? second : first;
        return this.walletClient.signMessage({
          account: this.account,
          message: normalizeMessage(message),
        });
      }

      case 'eth_sign': {
        const [, message] = params;
        return this.walletClient.signMessage({
          account: this.account,
          message: normalizeMessage(message),
        });
      }

      // v3 payloads (no arrays or recursive structs) hash identically under
      // v4 rules, so both versions share the same signing path.
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4': {
        const [, typedData] = params;
        const parsed =
          typeof typedData === 'string'
            ? JSON.parse(typedData)
            : typedData;

        return this.walletClient.signTypedData({
          account: this.account,
          domain: parsed.domain,
          message: parsed.message,
          primaryType: parsed.primaryType,
          types: parsed.types,
        });
      }

      case 'eth_signTypedData':
        throw new Error(
          'eth_signTypedData (legacy v1) is not supported by PrivateKeyRpcClient. Use eth_signTypedData_v4.',
        );

      // Also a broadcast — it must not slip past the chain check through the
      // default passthrough.
      case 'eth_sendRawTransaction': {
        await this.assertRpcChainMatches();
        const hash = (await this.publicClient.request(
          request as Parameters<typeof this.publicClient.request>[0],
        )) as Hex;
        this.sentTransactions.push(hash);
        this.sentTransactionRequests.push({ hash });
        return hash;
      }

      case 'eth_sendTransaction': {
        const [transaction] = params as [Record<string, unknown> | undefined];
        if (!transaction) {
          throw new Error('eth_sendTransaction requires a transaction object.');
        }

        await this.assertRpcChainMatches();
        const request = this.toSendTransactionRequest(transaction);

        const hash = await this.walletClient.sendTransaction(
          request as Parameters<WalletClient['sendTransaction']>[0],
        );
        this.sentTransactions.push(hash);
        this.sentTransactionRequests.push({
          accessList: request.accessList,
          from: this.account.address,
          gas: request.gas?.toString(),
          gasPrice: request.gasPrice?.toString(),
          hash,
          maxFeePerBlobGas: request.maxFeePerBlobGas?.toString(),
          maxFeePerGas: request.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: request.maxPriorityFeePerGas?.toString(),
          nonce: request.nonce,
          to: request.to,
          data: request.data,
          type: request.type,
          value: request.value?.toString(),
        });
        return hash;
      }

      default:
        return this.publicClient.request(
          request as Parameters<typeof this.publicClient.request>[0],
        );
    }
  }

  /** Read-only viem public client backing this wallet (matchers, receipt waits). */
  get client() {
    return this.publicClient;
  }

  /** Signs an EIP-7702 authorization with this client's local account. */
  async signAuthorization(options: {
    contractAddress: Hex;
    chainId?: number;
    nonce?: number;
    executor?: 'self';
  }) {
    return this.walletClient.signAuthorization({
      account: this.account,
      contractAddress: options.contractAddress,
      chainId: options.chainId,
      nonce: options.nonce,
      executor: options.executor,
    } as Parameters<WalletClient['signAuthorization']>[0]);
  }

  // A mismatched rpcUrl/chain pair must fail loudly before anything is
  // broadcast; success is cached, failures retry so a transient RPC error
  // does not poison the client.
  private async assertRpcChainMatches(): Promise<void> {
    if (this.rpcChainVerified) {
      return;
    }

    const reportedChainId = await this.publicClient.getChainId();
    if (reportedChainId !== this.chain.id) {
      throw new Error(
        `The RPC endpoint reports chain id ${reportedChainId} but this client is configured for "${this.chain.name}" (id ${this.chain.id}). ` +
          'Refusing to broadcast. Check the rpcUrl and chain options.',
      );
    }

    this.rpcChainVerified = true;
  }

  private toSendTransactionRequest(
    transaction: Record<string, unknown>,
  ): ParsedSendTransactionRequest {
    const from = parseAddressField(transaction.from, 'from');
    if (from && from.toLowerCase() !== this.account.address.toLowerCase()) {
      throw providerError(
        4100,
        `eth_sendTransaction requested from ${from}, but this PrivateKeyRpcClient only controls ${this.account.address}.`,
      );
    }

    const chainId = parseChainId(transaction.chainId);
    if (chainId !== undefined && chainId !== this.chain.id) {
      throw new Error(
        `eth_sendTransaction chainId ${chainId} does not match configured chain "${this.chain.name}" (id ${this.chain.id}).`,
      );
    }

    return {
      account: this.account,
      accessList: parseAccessList(transaction.accessList),
      authorizationList: parseAuthorizationList(transaction.authorizationList),
      blobVersionedHashes: parseHexArrayField(transaction.blobVersionedHashes, 'blobVersionedHashes'),
      blobs: parseHexArrayField(transaction.blobs, 'blobs'),
      chain: this.chain,
      data: parseHexField(transaction.data ?? transaction.input, 'data'),
      gas: parseQuantity(transaction.gas, 'gas'),
      gasPrice: parseQuantity(transaction.gasPrice, 'gasPrice'),
      maxFeePerBlobGas: parseQuantity(transaction.maxFeePerBlobGas, 'maxFeePerBlobGas'),
      maxFeePerGas: parseQuantity(transaction.maxFeePerGas, 'maxFeePerGas'),
      maxPriorityFeePerGas: parseQuantity(transaction.maxPriorityFeePerGas, 'maxPriorityFeePerGas'),
      nonce: parseIndex(transaction.nonce, 'nonce'),
      to: parseNullableAddressField(transaction.to, 'to'),
      type: parseTransactionType(transaction.type),
      value: parseQuantity(transaction.value, 'value'),
    };
  }
}
