import { expect, test } from '../src/live-fixtures.js';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const openWalletDialog = async (page: import('@playwright/test').Page, address: string) => {
  await page
    .getByRole('button', {
      name: new RegExp(`${shortAddress(address)}.*Sepolia`, 'i'),
    })
    .click();
  return page.getByRole('dialog', { name: 'Wallet' });
};

const signIn = async (
  page: import('@playwright/test').Page,
  wallet: { primaryAccount: string },
) => {
  await page.goto('/');
  const walletDialog = await openWalletDialog(page, wallet.primaryAccount);
  const siweButton = walletDialog.locator('button').filter({ hasText: /^person_search$/ }).first();
  await expect(siweButton).toBeAttached();
  await siweButton.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(walletDialog.getByRole('button', { name: /Log out/i })).toBeVisible({
    timeout: 20_000,
  });
  return walletDialog;
};

test('Fjord logs out while leaving the wallet connected', async ({ page, wallet }) => {
  let walletDialog = await signIn(page, wallet);

  await walletDialog.getByRole('button', { name: /Log out/i }).click();
  await expect(walletDialog.locator('button').filter({ hasText: /^person_search$/ })).toBeAttached({
    timeout: 20_000,
  });

  await page.reload();
  await expect(
    page.getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    }),
  ).toBeVisible({ timeout: 15_000 });

  walletDialog = await openWalletDialog(page, wallet.primaryAccount);
  await expect(walletDialog.locator('button').filter({ hasText: /^person_search$/ })).toBeAttached();
});

test('Fjord keeps authenticated state after reload', async ({ page, wallet }) => {
  await signIn(page, wallet);

  await page.reload();
  await expect(
    page.getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    }),
  ).toBeVisible({ timeout: 15_000 });

  const walletDialog = await openWalletDialog(page, wallet.primaryAccount);
  await expect(walletDialog.getByRole('button', { name: /Log out/i })).toBeVisible({
    timeout: 20_000,
  });
});

test('Fjord disconnects the wallet from the wallet dialog', async ({ page, wallet }) => {
  await page.goto('/');
  const walletDialog = await openWalletDialog(page, wallet.primaryAccount);

  await walletDialog.getByRole('button', { name: /Disconnect/i }).click();
  await expect(page.getByRole('button', { name: /walletConnect|connect/i })).toBeVisible({
    timeout: 15_000,
  });
});

test('Fjord handles rejected SIWE signatures gracefully', async ({ page, wallet }) => {
  await page.goto('/');
  const walletDialog = await openWalletDialog(page, wallet.primaryAccount);

  await wallet.simulateRejection('personal_sign');
  const siweButton = walletDialog.locator('button').filter({ hasText: /^person_search$/ }).first();
  await siweButton.evaluate((button) => (button as HTMLButtonElement).click());

  await expect(walletDialog.locator('button').filter({ hasText: /^person_search$/ })).toBeAttached({
    timeout: 20_000,
  });
  await expect(walletDialog.getByRole('button', { name: /Log out/i })).toHaveCount(0);
});
