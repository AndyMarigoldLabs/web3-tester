import { expect, test } from '../src/live-fixtures.js';
import {
  createPublicClient,
  formatUnits,
  http,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

test.skip(!process.env.FJORD_PRIVATE_KEY, 'FJORD_PRIVATE_KEY is required for live Sepolia tests.');
test.skip(
  process.env.FJORD_MUTATE_STATE !== 'true',
  'Set FJORD_MUTATE_STATE=true to run live Sepolia mutation QA.',
);
// Deliberate opt-in: this QA suite auto-signs with the dedicated Sepolia QA
// key. Live wallets otherwise refuse approval-gated requests until armed.
test.use({ liveOptions: { walletOptions: { autoApprove: true } } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const erc20Abi = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const shortAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;
const qaRunId = process.env.FJORD_QA_RUN_ID ?? new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);

const pad2 = (value: number) => String(value).padStart(2, '0');
const formatDateTimeInput = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;

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

const closeResumeDraftDialog = async (page: import('@playwright/test').Page) => {
  const resumeDraftDialog = page
    .getByRole('dialog')
    .filter({ hasText: /Resume a saved draft|saved sale drafts/i });
  const isVisible = await resumeDraftDialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (isVisible) {
    await resumeDraftDialog.getByRole('button', { name: 'close' }).click({ force: true });
    await expect(resumeDraftDialog).toBeHidden();
  }
};

const reachFullLaunchSaleSettings = async (
  page: import('@playwright/test').Page,
  projectName: string,
) => {
  await page.goto('/sales/create');
  await expect(page.locator('body')).toContainText(/Quick Launch|Full Launch|Custom Configuration/i);
  await closeResumeDraftDialog(page);

  await page.getByRole('button', { name: /Recommended[\s\S]*Full Launch/i }).click();
  await expect(page.locator('[name="projectName"]')).toBeVisible();

  await page.locator('[name="projectName"]').fill(projectName);
  await page
    .locator('[name="shortDescription"]')
    .fill('QA-Codex live Sepolia mutation test.');
  await page.getByRole('button', { name: /Public Round/i }).click();
  await page
    .locator('[name="description"]')
    .fill(
      'QA-Codex live Sepolia mutation test artifact. This record is intentionally disposable and created for manual QA coverage.',
    );
  await page.locator('[name="logo"]').fill('https://placehold.co/256x256.png');
  await page.getByRole('button', { name: /Launch Solo/i }).click();
  await page.getByRole('button', { name: /Move to sale settings/i }).click();
  await expect(page.locator('body')).toContainText(/Sale Settings|Token|Payment|Price/i, {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Select Chain' }).click();
  await page.getByRole('option', { name: 'Sepolia', exact: true }).click();
};

const deployTokenFromSaleSettings = async ({
  liveClient,
  page,
  tokenDecimals,
  tokenName,
  tokenSupply,
  tokenSymbol,
}: {
  liveClient: { sentTransactions: Hex[] };
  page: import('@playwright/test').Page;
  tokenDecimals: number;
  tokenName: string;
  tokenSupply: string;
  tokenSymbol: string;
}) => {
  await page.getByRole('button', { name: /Do you need a token/i }).click();
  await expect(page.locator('body')).toContainText(/Deploy|Token Name|Symbol|Supply|Decimals/i, {
    timeout: 15_000,
  });

  await page.locator('[name="symbol"]').fill(tokenSymbol);
  await page.locator('[name="name"]').fill(tokenName);
  await page.locator('[name="supply"]').fill(tokenSupply);
  await page.locator('[name="decimals"]').fill(String(tokenDecimals));

  const transactionCountBefore = liveClient.sentTransactions.length;
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect
    .poll(() => liveClient.sentTransactions.length, { timeout: 60_000 })
    .toBeGreaterThan(transactionCountBefore);

  const deploymentHash = liveClient.sentTransactions.at(-1)!;
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentHash,
    timeout: 120_000,
  });

  expect(receipt.status).toBe('success');

  const projectTokenInput = page
    .getByPlaceholder('0x0000000000000000000000000000000000000000')
    .first();
  await expect(projectTokenInput).toHaveValue(/^0x[a-fA-F0-9]{40}$/, { timeout: 30_000 });

  const tokenAddress = (receipt.contractAddress ?? (await projectTokenInput.inputValue())) as Address;
  const [actualName, actualSymbol, actualDecimals, actualSupply] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'name' }),
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'totalSupply' }),
  ]);

  expect(actualName).toBe(tokenName);
  expect(actualSymbol).toBe(tokenSymbol);
  expect(actualDecimals).toBe(tokenDecimals);
  expect(actualSupply.toString()).toBe(tokenSupply);

  return {
    formattedSupply: formatUnits(actualSupply, tokenDecimals),
    tokenAddress,
    transactionHash: deploymentHash,
  };
};

test('deploys and verifies a QA Sepolia ERC-20 token from the Fjord creation flow', async ({
  liveClient,
  page,
  wallet,
}) => {
  const tokenName = `QA Codex Token ${qaRunId}`;
  const tokenSymbol = `Q${qaRunId.slice(-5)}`;
  const tokenSupply = '1000000';
  const tokenDecimals = 18;

  await signIn(page, wallet);
  await reachFullLaunchSaleSettings(page, `QA-Codex-TokenDeploy-${qaRunId}`);
  const deployedToken = await deployTokenFromSaleSettings({
    liveClient,
    page,
    tokenDecimals,
    tokenName,
    tokenSupply,
    tokenSymbol,
  });

  console.log(`QA token deployed: ${deployedToken.tokenAddress}`);
  console.log(`QA token tx: ${deployedToken.transactionHash}`);
  console.log(`QA token formatted supply: ${deployedToken.formattedSupply}`);
});

test('creates a QA fixed-price Sepolia sale draft and reaches review', async ({
  liveClient,
  page,
  wallet,
}) => {
  const projectName = `QA-Codex-Fixed-${qaRunId}`;
  const tokenName = `QA Codex Fixed ${qaRunId}`;
  const tokenSymbol = `F${qaRunId.slice(-5)}`;
  const tokenDecimals = 18;
  const tokenSupply = '1000000000000000000000000';

  await signIn(page, wallet);
  await reachFullLaunchSaleSettings(page, projectName);
  const deployedToken = await deployTokenFromSaleSettings({
    liveClient,
    page,
    tokenDecimals,
    tokenName,
    tokenSupply,
    tokenSymbol,
  });
  console.log(`QA fixed sale token deployed: ${deployedToken.tokenAddress}`);
  console.log(`QA fixed sale token tx: ${deployedToken.transactionHash}`);

  await page.getByRole('button', { name: /Select Token/i }).click();
  const tokenDialog = page.getByRole('dialog').filter({ hasText: /Select Collateral Token/i });
  await tokenDialog.getByText('Wrapped Ether', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^WETH/ })).toBeVisible();

  const start = new Date(Date.now() + 90 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
  await page.getByTestId('startDate').fill(formatDateTimeInput(start));
  await page.getByTestId('endDate').fill(formatDateTimeInput(end));
  await page.getByRole('option', { name: /Fixed Price/i }).click();
  await expect(page.locator('body')).toContainText(/Fundraising Goal|Shares for Sale|Token Price/i);

  const inputs = page.locator('input');
  await inputs.nth(4).fill('1000');
  await inputs.nth(5).fill('0.00001');
  await inputs.nth(6).fill('1000');
  await inputs.nth(7).fill('0.01');
  await inputs.nth(8).fill('0.01');
  await inputs.nth(9).fill('0.0001');
  await inputs.nth(10).fill('0.005');

  await page.getByRole('button', { name: /Save Draft/i }).click();
  const draftDialog = page.getByRole('dialog', { name: /Name your draft/i });
  await expect(draftDialog).toBeVisible({ timeout: 15_000 });
  await draftDialog.getByPlaceholder('Fjapybara').fill(projectName);
  await draftDialog.getByRole('button', { name: /Save/i }).click();
  await expect(draftDialog).toBeHidden({ timeout: 20_000 });

  await page.getByRole('button', { name: /Move to confirma/i }).click();
  await expect(page.getByRole('button', { name: /Publish/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('body')).toContainText(/Terms & Conditions|Create & Publish Pool/i);
  const reviewText = await page.locator('body').innerText();
  console.log(`QA fixed sale review contains token symbol: ${reviewText.includes(tokenSymbol)}`);

  if (process.env.FJORD_PUBLISH_SALES === 'true') {
    const transactionCountBeforePublish = liveClient.sentTransactions.length;
    await page.getByRole('checkbox').check();
    let publishTransactionHash: Hex | undefined;

    for (let attempt = 0; attempt < 4 && !publishTransactionHash; attempt += 1) {
      const transactionCountBeforeAttempt = liveClient.sentTransactions.length;
      await page.getByRole('button', { name: /Create.*publish/i }).click({ timeout: 90_000 });
      await expect
        .poll(() => liveClient.sentTransactions.length, { timeout: 120_000 })
        .toBeGreaterThan(transactionCountBeforeAttempt);

      const latestRequest = liveClient.sentTransactionRequests.at(-1);
      expect(latestRequest).toBeTruthy();
      await publicClient.waitForTransactionReceipt({
        hash: latestRequest!.hash,
        timeout: 120_000,
      });

      if (!latestRequest!.data?.startsWith('0x095ea7b3')) {
        publishTransactionHash = latestRequest!.hash;
      }
    }

    expect(publishTransactionHash, 'expected a non-approval publish transaction').toBeTruthy();
    await expect(page.locator('body')).toContainText(/success|published|view sale/i, {
      timeout: 180_000,
    });
    console.log(
      `QA fixed sale publish txs: ${liveClient.sentTransactions
        .slice(transactionCountBeforePublish)
        .join(', ')}`,
    );
    console.log(`QA fixed sale publish tx: ${publishTransactionHash}`);
    console.log(`QA fixed sale post-publish url: ${page.url()}`);
  }
});

test('resumes an approved QA fixed-price draft and attempts publish', async ({
  liveClient,
  page,
  wallet,
}) => {
  const draftName = process.env.FJORD_RESUME_DRAFT_NAME;
  test.skip(!draftName, 'Set FJORD_RESUME_DRAFT_NAME to resume a specific QA draft.');

  await signIn(page, wallet);
  await page.goto('/sales/create');

  const resumeDraftDialog = page
    .getByRole('dialog')
    .filter({ hasText: /Resume a saved draft|saved sale drafts/i });
  await expect(resumeDraftDialog).toBeVisible({ timeout: 15_000 });
  await resumeDraftDialog.getByRole('button', { name: new RegExp(draftName!, 'i') }).click();
  await expect(resumeDraftDialog).toBeHidden({ timeout: 20_000 });

  if ((await page.getByRole('button', { name: /Publish/i }).count()) === 0) {
    await page.getByRole('button', { name: /Move to confirma/i }).click();
  }

  await expect(page.getByRole('button', { name: /Publish/i })).toBeVisible({
    timeout: 30_000,
  });
  const checkbox = page.getByRole('checkbox');
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
  }

  const transactionCountBeforePublish = liveClient.sentTransactions.length;
  await page.getByRole('button', { name: /Create.*publish/i }).click();
  await expect
    .poll(() => liveClient.sentTransactions.length, { timeout: 120_000 })
    .toBeGreaterThan(transactionCountBeforePublish);

  const publishRequest = liveClient.sentTransactionRequests.at(-1);
  expect(publishRequest).toBeTruthy();
  await publicClient.waitForTransactionReceipt({
    hash: publishRequest!.hash,
    timeout: 120_000,
  });

  console.log(`QA resumed draft publish tx: ${publishRequest!.hash}`);
  console.log(`QA resumed draft publish tx method: ${publishRequest!.data?.slice(0, 10)}`);
  await expect(page.locator('body')).toContainText(/success|published|view sale/i, {
    timeout: 180_000,
  });
  console.log(`QA resumed draft post-publish url: ${page.url()}`);
});

test('explores the live Sepolia sale settings form for QA sale creation', async ({
  page,
  wallet,
}) => {
  test.skip(
    process.env.FJORD_EXPLORE_SALE_CREATE !== 'true',
    'Set FJORD_EXPLORE_SALE_CREATE=true to inspect the live sale creation form.',
  );

  await signIn(page, wallet);
  await reachFullLaunchSaleSettings(page, `QA-Codex-Explore-${qaRunId}`);

  const projectTokenAddress = process.env.FJORD_PROJECT_TOKEN_ADDRESS;
  if (projectTokenAddress) {
    await page
      .getByPlaceholder('0x0000000000000000000000000000000000000000')
      .first()
      .fill(projectTokenAddress);
  }

  const selectTokenButton = page.getByRole('button', { name: /Select Token/i });
  console.log(`select token button count: ${await selectTokenButton.count()}`);
  await selectTokenButton.click();
  await page.waitForTimeout(1_000);
  console.log(`dialog count after collateral click: ${await page.getByRole('dialog').count()}`);
  const tokenDialog = page.getByRole('dialog').filter({ hasText: /Select Collateral Token/i });
  await tokenDialog.getByText('Wrapped Ether', { exact: true }).click();

  const start = new Date(Date.now() + 90 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
  const dateInputs = page.getByPlaceholder('01/05/2025 15:00');
  await dateInputs.nth(0).fill(formatDateTimeInput(start));
  await dateInputs.nth(1).fill(formatDateTimeInput(end));
  await page.getByRole('option', { name: /Fixed Price/i }).click();
  await page.waitForTimeout(1_000);
  const inputs = await page.locator('input').evaluateAll((elements) =>
    elements.map((element) => {
      const input = element as HTMLInputElement;
      return {
        ariaLabel: input.getAttribute('aria-label'),
        name: input.name,
        placeholder: input.placeholder,
        testId: input.getAttribute('data-testid'),
        type: input.type,
        value: input.value,
      };
    }),
  );
  console.log(JSON.stringify(inputs, null, 2));
  console.log(await page.locator('body').innerText());
});
