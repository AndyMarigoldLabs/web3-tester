export {};

type SolanaPublicKeyLike = {
  toString: () => string;
  toBase58: () => string;
  toBytes: () => Uint8Array;
  equals: (other: unknown) => boolean;
};

type SolanaProviderLike = {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  isPhantom?: boolean;
  isBackpack?: boolean;
  isSafePal?: boolean;
  isSolflare?: boolean;
  isMathWallet?: boolean;
  publicKey: SolanaPublicKeyLike | null;
  isConnected: boolean;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: SolanaPublicKeyLike }>;
  disconnect: () => Promise<void>;
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  signIn: (input?: Record<string, unknown>) => Promise<{
    address: string;
    publicKey: SolanaPublicKeyLike;
    signedMessage: Uint8Array;
    signature: Uint8Array;
  }>;
  signMessage: (message: Uint8Array | ArrayBuffer | string) => Promise<{
    publicKey: SolanaPublicKeyLike;
    signature: Uint8Array;
  }>;
  signTransaction: <T>(transaction: T) => Promise<T>;
  signAllTransactions: <T>(transactions: T[]) => Promise<T[]>;
  signAndSendTransaction: (transaction: unknown) => Promise<{ signature: string }>;
  signAndSendAllTransactions: (transactions: unknown[]) => Promise<{
    publicKey: SolanaPublicKeyLike;
    signatures: string[];
  }>;
  on: (event: string, handler: (payload: unknown) => void) => unknown;
  addListener: (event: string, handler: (payload: unknown) => void) => unknown;
  removeListener: (event: string, handler: (payload: unknown) => void) => unknown;
  off: (event: string, handler: (payload: unknown) => void) => unknown;
  removeAllListeners: (event?: string) => unknown;
  listeners: (event: string) => unknown[];
  listenerCount: (event: string) => number;
};

declare global {
  interface Window {
    detected: {
      hasEthereum: boolean;
      chainId?: string;
      accounts?: string[];
      announcements: number;
    };
    results?: unknown;
    ethereum: {
      isMetaMask: boolean;
      isRabby?: boolean;
      isCoinbaseWallet?: boolean;
      isPhantom?: boolean;
      isRainbow?: boolean;
      isOkxWallet?: boolean;
      isOKExWallet?: boolean;
      isTrust?: boolean;
      isTrustWallet?: boolean;
      isBraveWallet?: boolean;
      isZerion?: boolean;
      isBackpack?: boolean;
      isLedger?: boolean;
      isLedgerWallet?: boolean;
      isTrezor?: boolean;
      isSafe?: boolean;
      isBitKeep?: boolean;
      isBitgetWallet?: boolean;
      isTokenPocket?: boolean;
      isSafePal?: boolean;
      isBinance?: boolean;
      isExtension?: boolean;
      isImToken?: boolean;
      isMathWallet?: boolean;
      isFrame?: boolean;
      isEnkrypt?: boolean;
      isAvalanche?: boolean;
      isCoreWallet?: boolean;
      isFrontier?: boolean;
      isOneKey?: boolean;
      isCTRL?: boolean;
      isXDEFI?: boolean;
      isUniswapWallet?: boolean;
      isArgent?: boolean;
      isExodus?: boolean;
      isFireblocks?: boolean;
      isMock: boolean;
      info: {
        uuid: string;
        name: string;
        icon: string;
        rdns: string;
      };
      providers?: Window['ethereum'][];
      selectedAddress: string | null;
      chainId: string;
      networkVersion: string;
      request: (args: { method: string; params?: unknown }) => Promise<unknown>;
      isConnected: () => boolean;
      enable: () => Promise<unknown>;
      send: (methodOrPayload: string | object | object[], paramsOrCallback?: unknown) => Promise<unknown>;
      sendAsync: {
        (
          payload: { id?: number; jsonrpc?: string; method: string; params?: unknown },
          callback: (error: unknown, response: { result?: unknown }) => void,
        ): void;
        (
          payload: Array<{ id?: number; jsonrpc?: string; method: string; params?: unknown }>,
          callback: (
            error: unknown,
            response: Array<{
              id?: number;
              jsonrpc?: string;
              result?: unknown;
              error?: { code: number; message: string; data?: unknown };
            }>,
          ) => void,
        ): void;
      };
      on: (event: string, handler: (payload: unknown) => void) => unknown;
      addListener: (event: string, handler: (payload: unknown) => void) => unknown;
      removeListener: (event: string, handler: (payload: unknown) => void) => unknown;
      off: (event: string, handler: (payload: unknown) => void) => unknown;
      removeAllListeners: (event?: string) => unknown;
      listeners: (event: string) => unknown[];
      listenerCount: (event: string) => number;
      _metamask?: {
        isUnlocked: () => Promise<boolean>;
      };
    };
    coinbaseWalletExtension?: Window['ethereum'];
    okxwallet?: Window['ethereum'];
    trustwallet?: Window['ethereum'];
    bitkeep?: Window['ethereum'] & { ethereum?: Window['ethereum'] };
    tokenpocket?: Window['ethereum'] & { ethereum?: Window['ethereum'] };
    safepalProvider?: Window['ethereum'];
    binancew3w?: Window['ethereum'] & { ethereum?: Window['ethereum'] };
    imToken?: Window['ethereum'];
    enkrypt?: { providers?: { ethereum?: Window['ethereum'] } };
    avalanche?: Window['ethereum'];
    frontier?: Window['ethereum'] & { ethereum?: Window['ethereum'] };
    $onekey?: Window['ethereum'] & { ethereum?: Window['ethereum'] };
    ctrl?: Window['ethereum'] & { ethereum?: Window['ethereum'] };
    xfi?: Window['ethereum'] & { ethereum?: Window['ethereum'] };
    solana?: SolanaProviderLike;
    phantom?: { ethereum?: Window['ethereum']; solana?: SolanaProviderLike };
    backpack?: { ethereum?: Window['ethereum']; solana?: SolanaProviderLike };
    solflare?: SolanaProviderLike;
    safepal?: SolanaProviderLike;
  }
}
