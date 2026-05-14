import { test as base } from '@playwright/test';
import { sepolia } from 'viem/chains';
import { MockWalletController } from './mock-wallet-controller.js';
import { PrivateKeyRpcClient } from './private-key-rpc-client.js';

export type LiveWeb3Fixtures = {
  wallet: MockWalletController;
  liveClient: PrivateKeyRpcClient;
};

export const test = base.extend<LiveWeb3Fixtures>({
  liveClient: async ({}, use) => {
    const privateKey = process.env.FJORD_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('FJORD_PRIVATE_KEY is required for live Sepolia Fjord tests.');
    }

    await use(
      new PrivateKeyRpcClient({
        privateKey: privateKey as `0x${string}`,
        chain: sepolia,
        rpcUrl: process.env.SEPOLIA_RPC_URL,
      }),
    );
  },

  wallet: async ({ page, liveClient }, use) => {
    const wallet = new MockWalletController(page, liveClient, {
      accounts: [liveClient.account.address],
      chainId: sepolia.id,
      autoApprove: true,
      connected: true,
      providerInfo: {
        name: 'MetaMask',
        rdns: 'io.metamask',
      },
    });

    await wallet.injectMockProvider();
    await use(wallet);
  },
});

export { expect } from '@playwright/test';
