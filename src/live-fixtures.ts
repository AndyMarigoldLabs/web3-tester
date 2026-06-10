import { test as base } from '@playwright/test';
import type { Chain } from 'viem';
import { sepolia } from 'viem/chains';
import {
  MockWalletController,
  type MockWalletControllerOptions,
} from './mock-wallet-controller.js';
import { PrivateKeyRpcClient } from './private-key-rpc-client.js';

export type LiveFixtureOptions = {
  /** Target chain. Defaults to Sepolia. */
  chain?: Chain;
  /**
   * Passed through to PrivateKeyRpcClient for chains that are neither
   * `testnet: true` nor local dev chains. Without it such chains throw at
   * fixture setup.
   */
  allowMainnet?: boolean;
  /** Env var holding the signing key. Defaults to WEB3_TESTER_PRIVATE_KEY. */
  privateKeyEnv?: string;
  /** Env var holding the RPC URL. Defaults to WEB3_TESTER_RPC_URL. */
  rpcUrlEnv?: string;
  /**
   * Per-test overrides for the injected wallet (provider identity,
   * autoApprove, allowedOrigins, …). Live wallets default to
   * autoApprove: false and origin-scope the provider to baseURL; override
   * here only for keys you are comfortable auto-signing with.
   */
  walletOptions?: Omit<Partial<MockWalletControllerOptions>, 'accounts' | 'chainId'>;
};

export type LiveWeb3Fixtures = {
  liveOptions: LiveFixtureOptions;
  liveClient: PrivateKeyRpcClient;
  wallet: MockWalletController;
};

const resolveEnv = (names: readonly (string | undefined)[]): string | undefined => {
  for (const name of names) {
    if (name && process.env[name]) {
      return process.env[name];
    }
  }
  return undefined;
};

/**
 * Builds a live-chain fixture family. The defaults read the signing key from
 * WEB3_TESTER_PRIVATE_KEY (with the legacy FJORD_PRIVATE_KEY still honored)
 * and target Sepolia; pass options to bind other chains or env var names.
 */
export function createLiveFixtures(defaults: LiveFixtureOptions = {}) {
  return base.extend<LiveWeb3Fixtures>({
    liveOptions: [
      async ({}, use) => {
        await use(defaults);
      },
      { option: true },
    ],

    liveClient: async ({ liveOptions }, use) => {
      const options = { ...defaults, ...liveOptions };
      const privateKeyEnv = options.privateKeyEnv ?? 'WEB3_TESTER_PRIVATE_KEY';
      const privateKey = resolveEnv([privateKeyEnv, 'FJORD_PRIVATE_KEY']);
      if (!privateKey) {
        throw new Error(`${privateKeyEnv} is required for live-chain tests.`);
      }

      const rpcUrlEnv = options.rpcUrlEnv ?? 'WEB3_TESTER_RPC_URL';

      await use(
        new PrivateKeyRpcClient({
          privateKey: privateKey as `0x${string}`,
          chain: options.chain ?? sepolia,
          rpcUrl: resolveEnv([rpcUrlEnv, 'SEPOLIA_RPC_URL']),
          allowMainnet: options.allowMainnet,
        }),
      );
    },

    wallet: async ({ page, liveClient, liveOptions, baseURL }, use) => {
      const options = { ...defaults, ...liveOptions };
      const wallet = new MockWalletController(page, liveClient, {
        accounts: [liveClient.account.address],
        chainId: liveClient.chain.id,
        // A real key sits behind this provider, so nothing signs or connects
        // until the test arms it (wallet.approveNext(...) for one request,
        // wallet.autoApprove(true) or walletOptions for a whole test), and
        // only frames on the dapp's own origin can reach the wallet at all.
        autoApprove: false,
        connected: true,
        // EIP-5792 stays off over a real key: capability-probing dapps keep
        // the eth_sendTransaction fallback with per-transaction arming,
        // capping a bare approveNext() at one real transaction.
        eip5792: false,
        ...(baseURL ? { allowedOrigins: [baseURL] } : {}),
        // Masquerade as MetaMask by default so production wallet selectors
        // (wagmi / EIP-6963) detect the injected provider unmodified.
        providerInfo: { name: 'MetaMask', rdns: 'io.metamask' },
        ...options.walletOptions,
      });

      await wallet.injectMockProvider();
      await use(wallet);
    },
  });
}

export const test = createLiveFixtures();

// The web3-extended expect: every matcher from ./matchers.js, zero migration.
export { expect } from './matchers.js';
