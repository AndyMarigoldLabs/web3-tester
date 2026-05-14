import type { JsonRpcErrorPayload, ProviderRpcErrorLike } from './types.js';

export const providerError = (
  code: number,
  message: string,
  data?: unknown,
): ProviderRpcErrorLike => {
  const error = new Error(message) as ProviderRpcErrorLike;
  error.code = code;
  if (data !== undefined) {
    error.data = data;
  }
  return error;
};

export const serializeRpcError = (error: unknown): JsonRpcErrorPayload => {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as Partial<ProviderRpcErrorLike>;
    return {
      code: typeof maybeError.code === 'number' ? maybeError.code : -32603,
      message:
        typeof maybeError.message === 'string'
          ? maybeError.message
          : 'Internal JSON-RPC error',
      data: maybeError.data,
    };
  }

  return {
    code: -32603,
    message: typeof error === 'string' ? error : 'Internal JSON-RPC error',
  };
};
