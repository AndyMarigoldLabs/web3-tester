import {
  createPublicClient,
  createWalletClient,
  hexToString,
  http,
  isAddress,
  type Account,
  type Chain,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import type { JsonRpcRequest, RpcClient } from './types.js';

export type PrivateKeyRpcClientOptions = {
  privateKey: Hex;
  chain?: Chain;
  rpcUrl?: string;
};

const normalizePrivateKey = (privateKey: string): Hex => {
  const trimmed = privateKey.trim();
  return trimmed.startsWith('0x') ? (trimmed as Hex) : (`0x${trimmed}` as Hex);
};

const asHex = (value: unknown): Hex | undefined =>
  typeof value === 'string' && value.startsWith('0x') ? (value as Hex) : undefined;

const normalizeMessage = (message: unknown): string | { raw: Hex } => {
  const hex = asHex(message);
  if (!hex) {
    return String(message ?? '');
  }

  try {
    return hexToString(hex);
  } catch {
    return { raw: hex };
  }
};

const parseParams = (request: JsonRpcRequest): unknown[] =>
  Array.isArray(request.params) ? [...request.params] : [];

export class PrivateKeyRpcClient implements RpcClient {
  readonly account: Account;
  readonly chain: Chain;
  readonly sentTransactions: Hex[] = [];
  readonly sentTransactionRequests: Array<{
    hash: Hex;
    to?: Hex;
    data?: Hex;
    value?: string;
  }> = [];

  private readonly publicClient;
  private readonly walletClient: WalletClient;

  constructor(options: PrivateKeyRpcClientOptions) {
    this.chain = options.chain ?? sepolia;
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
      case 'personal_sign': {
        const [first, second] = params;
        const message =
          typeof first === 'string' && isAddress(first) && second !== undefined
            ? second
            : first;
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

      case 'eth_sendTransaction': {
        const [transaction] = params as [Record<string, unknown> | undefined];
        if (!transaction) {
          throw new Error('eth_sendTransaction requires a transaction object.');
        }

        const request = {
          account: this.account,
          chain: this.chain,
          to: transaction.to as Hex | undefined,
          data: transaction.data as Hex | undefined,
          value: transaction.value ? BigInt(transaction.value as string) : undefined,
          gas: transaction.gas ? BigInt(transaction.gas as string) : undefined,
          gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice as string) : undefined,
          nonce: transaction.nonce ? Number(BigInt(transaction.nonce as string)) : undefined,
          maxFeePerGas: transaction.maxFeePerGas
            ? BigInt(transaction.maxFeePerGas as string)
            : undefined,
          maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
            ? BigInt(transaction.maxPriorityFeePerGas as string)
            : undefined,
        };

        const hash = await this.walletClient.sendTransaction(request as never);
        this.sentTransactions.push(hash);
        this.sentTransactionRequests.push({
          hash,
          to: transaction.to as Hex | undefined,
          data: transaction.data as Hex | undefined,
          value: transaction.value ? String(transaction.value) : undefined,
        });
        return hash;
      }

      default:
        return this.publicClient.request(request as never);
    }
  }
}
