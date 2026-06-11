import { expect, test } from '@marigoldlabs/web3-tester/live-fixtures';

test.skip(
  !process.env.WEB3_TESTER_PRIVATE_KEY,
  'WEB3_TESTER_PRIVATE_KEY is required for live Sepolia tests.',
);

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

test('signs only after the test arms the request (deny-by-default)', async ({ page, wallet }) => {
  await page.goto('/');

  // Live wallets refuse signing until armed; arm exactly one personal_sign.
  wallet.approveNext('personal_sign');

  const signature = await page.evaluate(async () =>
    (window as typeof window & { ethereum: EthereumProvider }).ethereum.request({
      method: 'personal_sign',
      params: ['0x68656c6c6f', null],
    }),
  );

  expect(String(signature)).toMatch(/^0x/);
});
