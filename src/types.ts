import type { Address, Hex } from 'viem';
import type { foundry } from 'viem/chains';

export type JsonRpcParams = readonly unknown[] | Record<string, unknown> | undefined;

export type JsonRpcRequest = {
  method: string;
  params?: JsonRpcParams;
};

export type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponseEnvelope =
  | { ok: true; result: unknown }
  | { ok: false; error: JsonRpcErrorPayload };

export type RpcClient = {
  request: (request: JsonRpcRequest) => Promise<unknown>;
};

export type AnvilChain = typeof foundry;

export type WalletProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type MockWalletConfig = {
  accounts: readonly Address[];
  chainId: Hex;
  connected: boolean;
  autoApprove: boolean;
  providers: readonly WalletProviderInfo[];
  allowedOrigins?: readonly string[];
};

export type ProviderRpcErrorLike = Error & {
  code: number;
  data?: unknown;
};
