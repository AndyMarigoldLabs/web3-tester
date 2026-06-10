import { expect, test } from '../src/live-fixtures.js';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
test.setTimeout(90_000);

// No autoApprove opt-in here on purpose: the wallet stays default-deny, so
// only the single armed SIWE signature can happen — any transaction attempt
// is rejected with 4001, making this spec read-only by construction.

const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

const signIn = async (
  page: import('@playwright/test').Page,
  wallet: {
    primaryAccount: string;
    approveNext: (
      methods?: string | readonly string[],
      match?: (method: string, params: readonly unknown[]) => boolean,
    ) => void;
  },
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
  // The grant is bound to the SIWE login message (its first line carries the
  // dapp domain), so no other page script can race it for a signature over
  // different data.
  wallet.approveNext('personal_sign', (_method, params) => {
    const hex = String(params[0] ?? '').replace(/^0x/, '');
    const text = Buffer.from(hex, 'hex').toString('utf8');
    return /fjordfoundry\.com/i.test(text);
  });
  await siweButton.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(walletDialog.getByRole('button', { name: /Log out/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Escape');
};

test('Fjord exposes the Sepolia ERC-20 deployment modal before transaction submission', async ({
  liveClient,
  page,
  wallet,
}) => {
  await signIn(page, wallet);
  await page.goto('/sales/create');
  await expect(page.locator('body')).toContainText(/Quick Launch|Full Launch|Custom Configuration/i);

  const resumeDraftDialog = page.getByRole('dialog').filter({ hasText: /Resume a saved draft/i });
  if (await resumeDraftDialog.isVisible()) {
    await resumeDraftDialog.getByRole('button', { name: 'close' }).click({ force: true });
    await expect(resumeDraftDialog).toBeHidden();
  }

  await page.getByRole('button', { name: /Recommended[\s\S]*Full Launch/i }).click();
  await expect(page.locator('[name="projectName"]')).toBeVisible();

  await page.locator('[name="projectName"]').fill('QA Token Access Check');
  await page.locator('[name="shortDescription"]').fill('Read-only QA pass for sale creation.');
  await page.getByRole('button', { name: /Public Round/i }).click();
  await page
    .locator('[name="description"]')
    .fill('This is a read-only QA flow used to inspect the sale settings step without saving or publishing.');
  await page.locator('[name="logo"]').fill('https://placehold.co/256x256.png');
  await page.getByRole('button', { name: /Launch Solo/i }).click();
  await page.getByRole('button', { name: /Move to sale settings/i }).click();
  await expect(page.locator('body')).toContainText(/Sale Settings|Token|Payment|Price/i, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Select Chain' }).click();
  await page.getByRole('option', { name: 'Sepolia', exact: true }).click();
  await page.getByRole('button', { name: /Do you need a token/i }).click();
  await expect(page.locator('body')).toContainText(/Deploy|Token Name|Symbol|Supply|Decimals/i, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Deploy' }).click();
  // Let any async submission path play out before asserting absence; the
  // default-deny wallet would reject it with 4001 anyway.
  await page.waitForTimeout(1_500);
  expect(liveClient.sentTransactions).toHaveLength(0);

  const symbolInput = page.locator('[name="symbol"]');
  await symbolInput.fill('QATESTLONG');
  await expect(symbolInput).toHaveValue('QATESTLONG');

  await symbolInput.fill('QATEST');
  await page.locator('[name="name"]').fill('QA Test Token');
  await page.locator('[name="supply"]').fill('1000000');
  await page.locator('[name="decimals"]').fill('18');

  await expect(symbolInput).toHaveValue('QATEST');
  await expect(page.locator('[name="name"]')).toHaveValue('QA Test Token');
  await expect(page.locator('[name="supply"]')).toHaveValue('1000000');
  await expect(page.locator('[name="decimals"]')).toHaveValue('18');
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeVisible();
});
