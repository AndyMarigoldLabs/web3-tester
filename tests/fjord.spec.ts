import { expect, test } from '../src/fixtures.js';

test('Fjord Foundry detects the injected wallet on load', async ({ page, wallet }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Fjord Foundry/);
  await expect(page.getByRole('link', { name: 'Token Sales' })).toBeVisible();
  await expect(page.getByText('Explore live and upcoming token sales on Fjord.')).toBeVisible();

  const shortAddress = `${wallet.primaryAccount.slice(0, 4)}...${wallet.primaryAccount.slice(-4)}`;
  await expect(
    page.getByRole('button', {
      name: new RegExp(`${shortAddress}.*Chain 31337`, 'i'),
    }),
  ).toBeVisible({ timeout: 15_000 });
});

test('Fjord can call the injected provider directly', async ({ page, wallet }) => {
  await page.goto('/');

  const providerState = await page.evaluate(async () => ({
    accounts: await window.ethereum.request({ method: 'eth_accounts' }),
    chainId: await window.ethereum.request({ method: 'eth_chainId' }),
  }));

  expect(providerState).toEqual({
    accounts: [wallet.primaryAccount],
    chainId: '0x7a69',
  });
});
