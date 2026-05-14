import { expect, test } from '@andy-marigold-labs/web3-tester/live-fixtures';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

test('loads a live Sepolia wallet', async ({ page, wallet }) => {
  await page.goto('/');

  await expect
    .poll(async () =>
      page.evaluate(async () =>
        (window as typeof window & { ethereum: EthereumProvider }).ethereum.request({
          method: 'eth_accounts',
        }),
      ),
    )
    .toEqual([wallet.primaryAccount]);
});
