import { expect, test } from '../src/live-fixtures.js';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
test.skip(
  process.env.FJORD_RUN_TRANSACTIONS !== 'true',
  'Set FJORD_RUN_TRANSACTIONS=true to spend testnet WETH.',
);
test.setTimeout(120_000);

const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const signIn = async (page: import('@playwright/test').Page, wallet: { primaryAccount: string }) => {
  await page
    .getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    })
    .click();

  const siweButton = page.locator('[role="dialog"] button').filter({ hasText: /^person_search$/ }).first();
  if ((await siweButton.count()) > 0) {
    await siweButton.evaluate((button) => (button as HTMLButtonElement).click());
  }

  const walletDialog = page.getByRole('dialog', { name: 'Wallet' });
  await expect(walletDialog.getByRole('button', { name: /Log out/i })).toBeVisible({
    timeout: 20_000,
  });
};

test('Fjord can submit a small Sepolia WETH purchase transaction', async ({
  page,
  wallet,
  liveClient,
}) => {
  await page.goto('/sales/price-discovery/11155111/0xb25900DEd088ecCf13a3Ca79E1316914eD9De3A6');
  await expect(page.locator('body')).toContainText(/Balance 0\.0[0-9]+[\s\S]*WETH/, {
    timeout: 20_000,
  });

  await signIn(page, wallet);
  await page.getByRole('button', { name: /keyboard_double_arrow_right/i }).click();

  const amountInput = page.getByPlaceholder('0.00').first();
  await amountInput.fill('0.001');
  await expect(page.locator('body')).toContainText('M18ERC20');

  await page.getByRole('button', { name: /^Swap$/ }).first().click();

  await expect.poll(() => liveClient.sentTransactions.length, { timeout: 60_000 }).toBeGreaterThan(0);
  const firstTransaction = liveClient.sentTransactionRequests[0];

  if (firstTransaction?.data?.startsWith('0x095ea7b3')) {
    await page.waitForTimeout(2_000);
    await page.getByRole('button', { name: /^Swap$/ }).first().click();
    await expect.poll(() => liveClient.sentTransactions.length, { timeout: 60_000 }).toBeGreaterThan(1);
  }

  console.log(`submitted transactions: ${liveClient.sentTransactions.join(', ')}`);
  expect(liveClient.sentTransactionRequests.some((request) => !request.data?.startsWith('0x095ea7b3'))).toBe(
    true,
  );
});
