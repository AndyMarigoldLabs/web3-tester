import { expect, test, type Locator, type Page } from '@playwright/test';

const liveSalesRegion = (page: Page) =>
  page.getByRole('region', { name: 'Live and upcoming token sales' });

const openLiveFilters = async (page: Page) => {
  const region = liveSalesRegion(page);
  const searchInputs = page.getByPlaceholder('Search by name, contract address, symbol etc');
  const filterButton = region.getByRole('button', { name: /Sort And Filter/i });

  await expect(filterButton).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await searchInputs.count()) >= 2) {
      return { region, search: searchInputs.first() };
    }

    await filterButton.click({ force: true });
    await page.waitForTimeout(500);
  }

  await expect(searchInputs).toHaveCount(2);
  return { region, search: searchInputs.first() };
};

const selectFilterOption = async (
  page: Page,
  region: Locator,
  buttonName: string | RegExp,
  optionName: string,
) => {
  const button = region.getByRole('button', { name: buttonName });
  await expect(button).toBeVisible();
  await button.click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
};

const expectLiveRows = async (region: Locator) => {
  await expect(region.getByRole('row', { name: /Sepolia Sell Event/i })).toBeVisible();
  await expect(region.getByRole('row', { name: /Polygon Autonomous Agent/i })).toBeVisible();
};

test('Fjord public homepage matches unauthenticated QA expectations', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Fjord Foundry/);
  await expect(page.getByRole('link', { name: 'Token Sales' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Launch Partners' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Help' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Staking/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /walletConnect|connect/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Profile$/i })).toHaveCount(0);
});

test('Fjord public search handles matches and empty results', async ({ page }) => {
  await page.goto('/');

  let { search } = await openLiveFilters(page);
  await expect(search).toBeVisible();

  await search.click();
  await search.pressSequentially('Sell Event', { delay: 20 });
  await expect(page.getByText('Sell Event #').first()).toBeVisible();

  await page.goto('/');

  ({ search } = await openLiveFilters(page));
  await search.click();
  await search.pressSequentially('xyznonexistent123', { delay: 20 });
  await expect(page.getByText('No Token Sales Found')).toBeVisible();
  await expect(page.getByText('Check your filters or launch a token sale.')).toBeVisible();

  await search.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await search.press('Backspace');
  await expect(page.getByText('Sell Event #').first()).toBeVisible();
});

test('Fjord live gallery card view and filters match visible rows', async ({ page }) => {
  await page.goto('/');

  const region = liveSalesRegion(page);
  const cardsTab = region.getByRole('tab', { name: 'Cards' }).filter({ visible: true });
  await expect(cardsTab).toHaveCount(1);
  await expect(region.getByRole('tab', { name: 'Table' }).filter({ visible: true })).toHaveAttribute(
    'data-state',
    'active',
  );
  await page.waitForTimeout(1_000);
  await cardsTab.click();
  await expect(region.getByRole('link', { name: 'Participate Now' }).first()).toBeVisible();
  await expect(region.getByText('Funds Raised').first()).toBeVisible();
  await expect(region.getByText('Sale Type').first()).toBeVisible();
  await expect(region.getByText('Time Left').first()).toBeVisible();

  const tableTab = region.getByRole('tab', { name: 'Table' }).filter({ visible: true });
  await expect(tableTab).toHaveCount(1);
  await tableTab.click({ force: true });
  await expectLiveRows(region);

  let opened = await openLiveFilters(page);
  await selectFilterOption(page, opened.region, 'Pool Status', 'Live');
  await expectLiveRows(opened.region);
  await selectFilterOption(page, opened.region, 'Live', 'Coming');
  await expect(opened.region.getByText('No Token Sales Found')).toBeVisible();
  await selectFilterOption(page, opened.region, 'Coming', 'All');
  await expectLiveRows(opened.region);

  await page.goto('/');
  opened = await openLiveFilters(page);
  await selectFilterOption(page, opened.region, 'Pool Type', 'LBP');
  await expect(opened.region.getByRole('row', { name: /Sepolia Sell Event/i })).toBeVisible();
  await expect(opened.region.getByRole('row', { name: /Polygon Autonomous Agent/i })).toHaveCount(0);
  await selectFilterOption(page, opened.region, 'LBP', 'Fixed');
  await expect(opened.region.getByRole('row', { name: /Polygon Autonomous Agent/i })).toBeVisible();
  await expect(opened.region.getByRole('row', { name: /Sepolia Sell Event/i })).toHaveCount(0);

  await page.goto('/');
  opened = await openLiveFilters(page);
  await selectFilterOption(page, opened.region, 'Pool Chain', 'Sepolia');
  await expect(opened.region.getByRole('row', { name: /Sepolia Sell Event/i })).toBeVisible();
  await expect(opened.region.getByRole('row', { name: /Polygon Autonomous Agent/i })).toHaveCount(0);
  await selectFilterOption(page, opened.region, 'Sepolia', 'Polygon');
  await expect(opened.region.getByRole('row', { name: /Polygon Autonomous Agent/i })).toBeVisible();
  await expect(opened.region.getByRole('row', { name: /Sepolia Sell Event/i })).toHaveCount(0);

  await page.goto('/');
  opened = await openLiveFilters(page);
  await selectFilterOption(page, opened.region, 'Curator', 'Honeypot Finance');
  await expect(opened.region.getByText('No Token Sales Found')).toBeVisible();
  await selectFilterOption(page, opened.region, 'Honeypot Finance', 'All Curators');
  await expectLiveRows(opened.region);

  await page.goto('/');
  opened = await openLiveFilters(page);
  await selectFilterOption(page, opened.region, 'Pool Status', 'Live');
  await selectFilterOption(page, opened.region, 'Pool Type', 'Fixed');
  await selectFilterOption(page, opened.region, 'Pool Chain', 'Polygon');
  await expect(opened.region.getByRole('row', { name: /Polygon Autonomous Agent/i })).toBeVisible();
  await expect(opened.region.getByRole('row', { name: /Sepolia Sell Event/i })).toHaveCount(0);
});

test('Fjord staking read-only and empty states hydrate', async ({ page }) => {
  await page.goto('/staking');

  await expect(page.getByText('Stake Your FJO')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Total FJO Rebought')).toBeVisible();
  await expect(page.getByText('Total FJO Burned')).toBeVisible();
  await expect(page.getByText('Total FJO Staked')).toBeVisible();
  await expect(page.getByRole('link', { name: /BUY FJO/i })).toHaveAttribute(
    'href',
    /app\.uniswap\.org/,
  );

  await expect(page.getByText('Staking Amount')).toBeVisible();
  const amountInput = page.getByPlaceholder('0.00');
  await amountInput.fill('1');
  await expect(amountInput).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Deposit FJO' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stake Fjord NFT' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdraw Before Lock' })).toBeDisabled();

  await page.goto('/staking/my-positions');
  await expect(page.getByText('Your Rewards')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0 FJO').first()).toBeVisible();
  await expect(page.getByText('+ 0 FJOINTS')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Full Claim 100%' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Instant Claim 50%' })).toBeDisabled();
  await expect(page.getByText('Your Locked Staking Positions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unstake All' })).toBeDisabled();

  await page.goto('/staking/airdrops');
  await expect(page.getByText('Airdrops & Auctions')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Wallet Required')).toBeVisible();
  await expect(page.getByText('Auction balances and claims are shown after wallet connection.')).toBeVisible();
});

test('Fjord curation and launch partner entry routes show gated states', async ({ page }) => {
  await page.goto('/apply-for-curation');
  await expect(page.getByText('Apply for Curation', { exact: true })).toBeVisible();
  await expect(page.getByText('Sign in with your wallet to apply for curation.')).toBeVisible();

  await page.goto('/become-launch-partner');
  await expect(page.getByText('Become a Launch Partner', { exact: true })).toBeVisible();
  await expect(page.getByText('Sign in with your wallet to apply to become a launch partner.')).toBeVisible();
});
