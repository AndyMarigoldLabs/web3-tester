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
export type JsonRpcResponseEnvelope = {
    ok: true;
    result: unknown;
} | {
    ok: false;
    error: JsonRpcErrorPayload;
};
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
export type SolanaProviderIdentity = {
    /** Base58 public key exposed by the simulated Solana provider. */
    publicKey?: string;
    /** CAIP-2 Solana chain identifiers exposed through Wallet Standard. */
    chains?: readonly string[];
    /** Wallet-specific boolean markers exposed on the Solana provider. */
    flags?: Readonly<Record<string, boolean>>;
    /** Additional window paths that should reference this provider. */
    aliases?: readonly string[];
};
export type WalletProviderIdentity = WalletProviderInfo & {
    /**
     * Whether this persona exposes an EIP-1193/EIP-6963 Ethereum provider.
     * Defaults to true. Set false for Solana-only wallets such as Solflare.
     */
    evm?: boolean;
    /**
     * Wallet-specific boolean markers exposed on the provider object
     * (`isMetaMask`, `isRabby`, `isCoinbaseWallet`, ...).
     */
    flags?: Readonly<Record<string, boolean>>;
    /**
     * Additional window paths that should reference this provider, e.g.
     * `phantom.ethereum` for Phantom's EVM provider.
     */
    aliases?: readonly string[];
    /**
     * Optional Phantom/Backpack-style Solana provider surface. This is a
     * browser-provider simulation for selector/auth UI tests, not a Solana
     * chain backend.
     */
    solana?: SolanaProviderIdentity;
};
export type MockWalletConfig = {
    accounts: readonly Address[];
    chainId: Hex;
    connected: boolean;
    unlocked: boolean;
    autoApprove: boolean;
    providers: readonly WalletProviderIdentity[];
    allowedOrigins?: readonly string[];
};
export type ProviderRpcErrorLike = Error & {
    code: number;
    data?: unknown;
};
//# sourceMappingURL=types.d.ts.map