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
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (payload: unknown) => void) => unknown;
      removeListener: (event: string, handler: (payload: unknown) => void) => unknown;
    };
  }
}
