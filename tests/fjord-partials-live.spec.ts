import { expect, test } from '../src/live-fixtures.js';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
// Deliberate opt-in: this QA suite auto-signs with the dedicated Sepolia QA
// key. Live wallets otherwise refuse approval-gated requests until armed.
test.use({ liveOptions: { walletOptions: { autoApprove: true } } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

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
};

test('Fjord partners dashboard route is either empty or explicitly gated', async ({
  page,
  wallet,
}) => {
  await signIn(page, wallet);

  await page.goto('/profile/partners-dashboard');
  await expect(page.locator('body')).toContainText(
    /Unable to load the partner dashboard|Curation Requests/,
    { timeout: 15_000 },
  );
  const dashboardError = page.getByText('Unable to load the partner dashboard.');
  if (await dashboardError.isVisible()) {
    await expect(page.getByText('{"message":"Unauthorized"}')).toBeVisible();
  } else {
    await expect(page.getByText('Curation Requests')).toBeVisible();
    await expect(page.getByText('Review curation request applications from projects.')).toBeVisible();
    await expect(page.getByText('No curation requests')).toBeVisible();
    await expect(page.getByText('Partnership requests').first()).toBeVisible();
    await expect(page.getByText('No partnership requests')).toBeVisible();
    await expect(page.getByRole('row', { name: /Project Name Ticker Status Answer Edit/i })).toBeVisible();
  }

  await page.goto('/curator/requests');
  await expect(page).toHaveURL(/\/profile\/connections|\/curator\/requests/);
  await expect(page.locator('body')).not.toContainText(/forbidden|access denied/i);
});

test('Fjord mobile wallet connection and sale detail render with the Sepolia wallet', async ({
  page,
  wallet,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');

  await expect(
    page.getByRole('button', {
      name: new RegExp(`${shortAddress(wallet.primaryAccount)}.*Sepolia`, 'i'),
    }),
  ).toBeVisible({ timeout: 15_000 });

  await signIn(page, wallet);
  await page.keyboard.press('Escape');

  await page.goto('/sales/price-discovery/11155111/0xb25900DEd088ecCf13a3Ca79E1316914eD9De3A6');
  await expect(page).toHaveURL(/\/sales\/price-discovery\/11155111\//);
  await expect(page.locator('body')).toContainText(/Participate|Swap|Sale/i);
  await expect(page.getByText('Price Discovery').first()).toBeVisible();
});

test('Fjord responds to provider disconnect emitted mid-session', async ({ page, wallet }) => {
  await signIn(page, wallet);

  await wallet.disconnect();

  await expect(page.getByRole('button', { name: /walletConnect|connect/i })).toBeVisible({
    timeout: 15_000,
  });
});

test('Fjord responds to provider network switching while connected', async ({ page, wallet }) => {
  await signIn(page, wallet);
  await page.keyboard.press('Escape');

  await wallet.switchNetwork(137);
  await expect(page.getByRole('button', { name: /0x76.*Polygon/i })).toBeVisible({
    timeout: 15_000,
  });

  await wallet.switchNetwork(11155111);
  await expect(page.getByRole('button', { name: /0x76.*Sepolia/i })).toBeVisible({
    timeout: 15_000,
  });
});
