import { expect, test } from '@andy-marigold-labs/web3-tester/fixtures';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

test('connects with the injected wallet', async ({ page, wallet }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.getByText('Mock Wallet').click();

  const providerState = await page.evaluate(async () => ({
    accounts: await ((window as typeof window & { ethereum: EthereumProvider }).ethereum.request({
      method: 'eth_accounts',
    }) as Promise<string[]>),
    chainId: await ((window as typeof window & { ethereum: EthereumProvider }).ethereum.request({
      method: 'eth_chainId',
    }) as Promise<string>),
  }));

  expect(providerState).toEqual({
    accounts: [wallet.primaryAccount],
    chainId: wallet.currentChainId,
  });
});

test('handles user rejection', async ({ page, wallet }) => {
  await page.goto('/');
  await wallet.simulateRejection('eth_sendTransaction');

  await page.getByRole('button', { name: /submit|swap|buy/i }).click();
  await expect(page.getByText(/rejected|declined|cancelled/i)).toBeVisible();
});
