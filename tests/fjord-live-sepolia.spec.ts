import { expect, test } from '../src/live-fixtures.js';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
test.setTimeout(60_000);
test.describe.configure({ mode: 'serial' });

const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const signIn = async (page: import('@playwright/test').Page, wallet: { primaryAccount: string }) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    })
    .click();

  const siweButton = page.locator('[role="dialog"] button').filter({ hasText: /^person_search$/ }).first();
  await expect(siweButton).toBeAttached();
  await siweButton.evaluate((button) => (button as HTMLButtonElement).click());

  const walletDialog = page.getByRole('dialog', { name: 'Wallet' });
  await expect(walletDialog.getByRole('button', { name: /Log out/i })).toBeVisible({
    timeout: 20_000,
  });
};

test('Fjord detects the funded Sepolia wallet on load', async ({ page, wallet }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Fjord Foundry/);
  await expect(
    page.getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    }),
  ).toBeVisible({ timeout: 15_000 });
});

test('Fjord completes SIWE using the injected Sepolia wallet', async ({ page, wallet }) => {
  await signIn(page, wallet);

  const walletDialog = page.getByRole('dialog', { name: 'Wallet' });
  await expect(walletDialog.getByText('Access Level')).toBeVisible();
  await expect(walletDialog.getByText(/Admin|User|Launch Partner|Moderator/)).toBeVisible();
});

test('Fjord opens a Sepolia sale detail page from the gallery', async ({ page }) => {
  await page.goto('/');

  await page.locator('a[href*="/sales/"][href*="/11155111/"]').first().click();

  await expect(page).toHaveURL(/\/sales\/[^/]+\/11155111\/0x[a-fA-F0-9]{40}/, {
    timeout: 15_000,
  });
  await expect(page.locator('body')).toContainText(/Participate|Sale|Token/i);
});

test('Fjord authenticated profile pages load for the Sepolia wallet', async ({ page, wallet }) => {
  await signIn(page, wallet);

  await page.goto('/profile/participation-history');
  await expect(page).toHaveURL(/\/profile\/participation-history/);
  await expect(page.locator('body')).toContainText(/Participation History|Sales you participated|Unclaimed/i);

  await page.goto('/profile/connections');
  await expect(page).toHaveURL(/\/profile\/connections/);
  await expect(page.locator('body')).toContainText(/Connected Sources|Available Sources|Ethereum/i);
});

test('Fjord admin read-only routes are accessible for the provided wallet', async ({ page, wallet }) => {
  await signIn(page, wallet);

  const adminRoutes = [
    '/admin/pools',
    '/admin/applications',
    '/admin/users',
    '/admin/curators',
    '/admin/spotlights',
    '/admin/pool-order',
    '/admin/presales',
    '/admin/analytics',
    '/admin/cache',
    '/admin/faucet',
    '/admin/audit',
  ];

  for (const route of adminRoutes) {
    await page.goto(route);
    await expect(page.locator('body')).not.toContainText(/unauthorized|forbidden|access denied/i);
  }
});
