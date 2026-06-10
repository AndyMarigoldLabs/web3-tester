import type { JsonRpcErrorPayload, ProviderRpcErrorLike } from './types.js';
export declare const providerError: (code: number, message: string, data?: unknown) => ProviderRpcErrorLike;
export declare const serializeRpcError: (error: unknown) => JsonRpcErrorPayload;
//# sourceMappingURL=errors.d.ts.map