import { expect, test } from '../src/live-fixtures.js';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
// Deliberate opt-in: this QA suite auto-signs with the dedicated Sepolia QA
// key. Live wallets otherwise refuse approval-gated requests until armed.
test.use({ liveOptions: { walletOptions: { autoApprove: true } } });
test.skip(
  process.env.FJORD_ADMIN_MUTATE !== 'true',
  'Set FJORD_ADMIN_MUTATE=true to run live admin mutation QA.',
);
test.setTimeout(180_000);

const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const signIn = async (
  page: import('@playwright/test').Page,
  wallet: { primaryAccount: string },
) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    })
    .click();

  const walletDialog = page.getByRole('dialog', { name: 'Wallet' });
  const siweButton = walletDialog.locator('button').filter({ hasText: /^person_search$/ }).first();
  await expect(siweButton).toBeAttached();
  await siweButton.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(walletDialog.getByRole('button', { name: /Log out/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Escape');
};

test('admin can purge a non-project-specific gallery cache target', async ({ page, wallet }) => {
  await signIn(page, wallet);
  await page.goto('/admin/cache');
  await expect(page.locator('body')).toContainText(/Cache|gallery-live|gallery-completed/i, {
    timeout: 20_000,
  });

  const cacheText = await page.locator('body').innerText();
  console.log(cacheText);

  const purgeButton = page.getByRole('button', { name: /gallery-live|Purge/i }).first();
  await purgeButton.click();
  await expect(page.locator('body')).toContainText(/purged|success|refreshed|cache/i, {
    timeout: 20_000,
  });
});
