export {};

declare global {
  interface Window {
    detected: {
      hasEthereum: boolean;
      chainId?: string;
      accounts?: string[];
      announcements: number;
    };
    ethereum: {
      isMetaMask: boolean;
      isMock: boolean;
      selectedAddress: string | null;
      chainId: string;
      networkVersion: string;
      request: (args: { method: string; params?: unknown }) => Promise<unknown>;
      isConnected: () => boolean;
      enable: () => Promise<unknown>;
      send: (methodOrPayload: string | object, paramsOrCallback?: unknown) => Promise<unknown>;
      sendAsync: (
        payload: { id?: number; jsonrpc?: string; method: string; params?: unknown },
        callback: (error: unknown, response: { result?: unknown }) => void,
      ) => void;
      on: (event: string, handler: (payload: unknown) => void) => unknown;
      removeListener: (event: string, handler: (payload: unknown) => void) => unknown;
    };
  }
}
