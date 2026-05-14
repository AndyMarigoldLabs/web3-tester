import { expect, test } from '@playwright/test';
import { sepolia } from 'viem/chains';
import { MockWalletController } from '../src/mock-wallet-controller.js';
import { PrivateKeyRpcClient } from '../src/private-key-rpc-client.js';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
test.setTimeout(60_000);

const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const setupWallet = async (
  page: import('@playwright/test').Page,
  options: { autoApprove: boolean },
) => {
  const privateKey = process.env.FJORD_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('FJORD_PRIVATE_KEY is required for live Sepolia tests.');
  }

  const liveClient = new PrivateKeyRpcClient({
    privateKey: privateKey as `0x${string}`,
    chain: sepolia,
    rpcUrl: process.env.SEPOLIA_RPC_URL,
  });

  const wallet = new MockWalletController(page, liveClient, {
    accounts: [liveClient.account.address],
    chainId: sepolia.id,
    autoApprove: options.autoApprove,
    connected: false,
    providerInfo: {
      name: 'MetaMask',
      rdns: 'io.metamask',
    },
  });

  await wallet.injectMockProvider();
  return wallet;
};

const clickMetaMask = async (page: import('@playwright/test').Page) => {
  const connectButton = page.getByRole('button', { name: /walletConnect|connect/i });
  await expect(connectButton).toBeVisible({ timeout: 15_000 });
  await connectButton.click();

  const metaMaskOption = page.getByText('MetaMask', { exact: true }).first();
  await expect(metaMaskOption).toBeVisible({ timeout: 15_000 });
  await metaMaskOption.click();
};

test('Fjord opens the wallet selector and connects the injected MetaMask provider', async ({
  page,
}) => {
  const wallet = await setupWallet(page, { autoApprove: true });

  await page.goto('/');
  await clickMetaMask(page);

  await expect(
    page.getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    }),
  ).toBeVisible({ timeout: 20_000 });
});

test('Fjord stays disconnected when the provider rejects account access', async ({ page }) => {
  const wallet = await setupWallet(page, { autoApprove: false });

  await page.goto('/');
  await clickMetaMask(page);

  await expect(page.getByRole('button', { name: /^wallet Connect$/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    }),
  ).toHaveCount(0);
});
