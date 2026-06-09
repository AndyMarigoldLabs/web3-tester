import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';

export type RealWalletProfile = {
  profileDirectory?: string;
  userDataDir: string;
};

export type RealWalletSetup = {
  password: string;
  seedPhrase?: string;
};

export type RealWalletGasSettings =
  | 'site'
  | 'low'
  | 'market'
  | 'aggressive'
  | {
      gasLimit?: number;
      maxBaseFee: number;
      priorityFee: number;
    };

export type RealWalletLaunchOptions = {
  baseURL?: string;
  expectedAddress?: string;
  extensionName?: string;
  extensionPath: string;
  headless?: boolean;
  profileDir: string;
  setup?: RealWalletSetup;
  slowMo?: number;
};

export type RealWalletController = {
  approveTokenPermission(options?: {
    gasSetting?: RealWalletGasSettings;
    spendLimit?: 'max' | number;
  }): Promise<void>;
  confirmSignature(): Promise<void>;
  confirmTransaction(options?: { gasSetting?: RealWalletGasSettings }): Promise<void>;
  connectToDapp(accounts?: string[]): Promise<void>;
  getAccountAddress(): Promise<string>;
  rejectSignature(): Promise<void>;
  rejectTransaction(): Promise<void>;
};

export type RealWalletSession = {
  approveTokenPermission(options?: {
    gasSetting?: RealWalletGasSettings;
    spendLimit?: 'max' | number;
  }): Promise<void>;
  close(): Promise<void>;
  confirmSignature(): Promise<void>;
  confirmTransaction(options?: { gasSetting?: RealWalletGasSettings }): Promise<void>;
  connectToDapp(accounts?: string[]): Promise<void>;
  context: BrowserContext;
  extensionId: string;
  getAccountAddress(): Promise<string>;
  rejectSignature(): Promise<void>;
  rejectTransaction(): Promise<void>;
  wallet: RealWalletController;
};

const DEFAULT_EXTENSION_NAME = 'MetaMask';
const DEFAULT_TIMEOUT_MS = 30_000;
const SHORT_TIMEOUT_MS = 2_000;
const testId = (id: string) => `[data-testid="${id}"]`;

function extensionUrl(extensionId: string, page = 'home.html') {
  return `chrome-extension://${extensionId}/${page}`;
}

function extensionIdFromUrl(url: string) {
  return /^chrome-extension:\/\/([^/]+)\//.exec(url)?.[1];
}

export function resolveRealWalletProfile(profileDir: string): RealWalletProfile {
  const resolved = path.resolve(profileDir);
  const profileDirectory = path.basename(resolved);
  const userDataDir = path.dirname(resolved);
  const looksLikeChromeProfile = /^(?:Default|Profile \d+)$/.test(profileDirectory);

  if (looksLikeChromeProfile && fs.existsSync(path.join(userDataDir, 'Local State'))) {
    return { profileDirectory, userDataDir };
  }

  return { userDataDir: resolved };
}

async function isVisible(locator: Locator, timeout = SHORT_TIMEOUT_MS) {
  await locator.first().waitFor({ state: 'visible', timeout });
  return true;
}

async function isHidden(locator: Locator, timeout = SHORT_TIMEOUT_MS) {
  await locator.first().waitFor({ state: 'hidden', timeout });
  return true;
}

async function clickFirstVisible(locators: readonly Locator[], timeout = SHORT_TIMEOUT_MS) {
  for (const locator of locators) {
    const target = locator.first();
    if (!(await isVisible(target, timeout).catch(() => false))) continue;
    await target.click();
    return true;
  }

  return false;
}

async function fillFirstVisible(
  locators: readonly Locator[],
  value: string,
  timeout = DEFAULT_TIMEOUT_MS,
) {
  for (const locator of locators) {
    const target = locator.first();
    if (!(await isVisible(target, timeout).catch(() => false))) continue;
    await target.fill(value);
    return true;
  }

  return false;
}

async function waitForMetaMaskReady(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined);
  await isHidden(
    page.locator('.spinner, .loading-overlay, [data-testid="loading-overlay"]'),
    DEFAULT_TIMEOUT_MS,
  ).catch(() => undefined);
}

async function closeMetaMaskOverlay(page: Page) {
  await clickFirstVisible(
    [
      page.locator(testId('popover-close')),
      page.locator('.mm-modal-content .mm-modal-header button').first(),
      page.getByRole('button', { name: 'Close' }),
    ],
    SHORT_TIMEOUT_MS,
  );
}

async function discoverExtensionIdFromRuntime(context: BrowserContext) {
  const workerId = context.serviceWorkers().map((worker) => extensionIdFromUrl(worker.url())).find(Boolean);
  if (workerId) return workerId;

  const pageId = context.pages().map((page) => extensionIdFromUrl(page.url())).find(Boolean);
  if (pageId) return pageId;

  const worker = await context.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => undefined);
  if (worker) {
    const extensionId = extensionIdFromUrl(worker.url());
    if (extensionId) return extensionId;
  }

  return undefined;
}

async function discoverExtensionIdFromManagementApi(context: BrowserContext, extensionName: string) {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded' });
    const extensions = await page.evaluate(() => {
      type ExtensionInfo = { id: string; name: string };
      const chromeApi = globalThis as unknown as {
        chrome?: {
          management?: {
            getAll(callback: (extensions: ExtensionInfo[]) => void): void;
          };
          runtime?: { lastError?: { message?: string } };
        };
      };

      return new Promise<ExtensionInfo[]>((resolve, reject) => {
        if (!chromeApi.chrome?.management?.getAll) {
          reject(new Error('chrome.management.getAll is not available on chrome://extensions.'));
          return;
        }

        chromeApi.chrome.management.getAll((items) => {
          const error = chromeApi.chrome?.runtime?.lastError;
          if (error) reject(new Error(error.message ?? 'Unable to enumerate Chrome extensions.'));
          else resolve(items);
        });
      });
    });

    const exact = extensions.find((extension) => extension.name.toLowerCase() === extensionName.toLowerCase());
    if (exact) return exact.id;

    const available = extensions.map((extension) => extension.name).sort().join(', ');
    throw new Error(`Unable to find extension "${extensionName}". Installed extensions: ${available || 'none'}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function getExtensionId(context: BrowserContext, extensionName: string) {
  return (
    (await discoverExtensionIdFromRuntime(context)) ??
    (await discoverExtensionIdFromManagementApi(context, extensionName))
  );
}

async function openExtensionHome(context: BrowserContext, extensionId: string) {
  const homeUrl = extensionUrl(extensionId);
  const existing = context.pages().find((page) => page.url().startsWith(homeUrl));
  const page = existing ?? (await context.newPage());
  if (!page.url().startsWith(homeUrl)) await page.goto(homeUrl);
  await waitForMetaMaskReady(page);
  return page;
}

function notificationUrlPrefix(extensionId: string) {
  return extensionUrl(extensionId, 'notification.html');
}

async function getNotificationPage(context: BrowserContext, extensionId: string, timeout = DEFAULT_TIMEOUT_MS) {
  const prefix = notificationUrlPrefix(extensionId);
  const startedAt = Date.now();
  let page = context.pages().find((candidate) => candidate.url().startsWith(prefix));

  while (!page && Date.now() - startedAt < timeout) {
    const pendingPages = context.pages().filter((candidate) => !candidate.isClosed());
    for (const pendingPage of pendingPages) {
      await pendingPage
        .waitForURL((url) => url.href.startsWith(prefix), { timeout: 250 })
        .catch(() => undefined);
      if (pendingPage.url().startsWith(prefix)) {
        page = pendingPage;
        break;
      }
    }
    if (page) break;

    const remaining = Math.max(timeout - (Date.now() - startedAt), 1_000);
    const candidate = await context.waitForEvent('page', { timeout: Math.min(remaining, 1_000) }).catch(() => undefined);
    if (!candidate) {
      page = context.pages().find((openPage) => openPage.url().startsWith(prefix));
      continue;
    }

    await candidate
      .waitForURL((url) => url.href.startsWith(prefix), { timeout: Math.min(remaining, 5_000) })
      .catch(() => undefined);
    if (candidate.url().startsWith(prefix)) page = candidate;
  }

  if (!page) throw new Error('Timed out waiting for MetaMask notification window.');
  await waitForMetaMaskReady(page);
  await page.bringToFront().catch(() => undefined);
  return page;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`.toLowerCase();
}

async function fillSeedPhrase(page: Page, seedPhrase: string) {
  const words = seedPhrase.trim().split(/\s+/);
  if (words.length < 12) {
    throw new Error('setup.seedPhrase must contain at least 12 words.');
  }

  const singleInputFilled = await fillFirstVisible(
    [
      page.locator(testId('srp-input-import__srp-note')),
      page.locator('textarea[name="seedPhrase"]'),
      page.locator('textarea').first(),
    ],
    words.join(' '),
    SHORT_TIMEOUT_MS,
  );
  if (singleInputFilled) return;

  const wordInputs = page.locator(
    'input[id^="import-srp__srp-word-"], input[data-testid^="import-srp__srp-word-"]',
  );
  if ((await wordInputs.count()) >= words.length) {
    for (const [index, word] of words.entries()) {
      await wordInputs.nth(index).fill(word);
    }
    return;
  }

  throw new Error('Unable to find MetaMask seed phrase input fields.');
}

async function importMetaMaskWallet(page: Page, setup: RealWalletSetup) {
  if (!setup.password || !setup.seedPhrase) {
    throw new Error(
      'MetaMask is on onboarding. Provide setup.password and setup.seedPhrase to import a wallet through web3-tester, or use a preconfigured persistent profile.',
    );
  }

  await page.bringToFront().catch(() => undefined);

  const terms = page.locator(testId('onboarding-terms-checkbox'));
  if (await isVisible(terms, SHORT_TIMEOUT_MS).catch(() => false)) {
    await terms.check();
  }

  const importStarted = await clickFirstVisible(
    [
      page.locator(testId('onboarding-import-wallet')),
      page.locator(testId('onboarding-import-with-srp-button')),
      page.getByRole('button', { name: 'Import an existing wallet' }),
      page.getByRole('button', { name: 'Import wallet' }),
    ],
    DEFAULT_TIMEOUT_MS,
  );
  if (!importStarted) throw new Error('Unable to start MetaMask wallet import flow.');

  await clickFirstVisible(
    [
      page.locator(testId('metametrics-no-thanks')),
      page.locator(testId('metametrics-i-agree')),
      page.getByRole('button', { name: 'No thanks' }),
      page.getByRole('button', { name: 'I agree' }),
    ],
    SHORT_TIMEOUT_MS,
  );

  await fillSeedPhrase(page, setup.seedPhrase);

  const seedConfirmed = await clickFirstVisible(
    [
      page.locator(testId('import-srp-confirm')),
      page.getByRole('button', { name: 'Confirm Secret Recovery Phrase' }),
      page.getByRole('button', { name: 'Confirm' }),
    ],
    DEFAULT_TIMEOUT_MS,
  );
  if (!seedConfirmed) throw new Error('Unable to confirm MetaMask seed phrase import.');

  const passwordFilled = await fillFirstVisible(
    [page.locator(testId('create-password-new-input')), page.locator('input[type="password"]').nth(0)],
    setup.password,
  );
  if (!passwordFilled) throw new Error('Unable to find MetaMask password input.');

  const confirmationPasswordFilled = await fillFirstVisible(
    [page.locator(testId('create-password-confirm-input')), page.locator('input[type="password"]').nth(1)],
    setup.password,
  );
  if (!confirmationPasswordFilled) throw new Error('Unable to find MetaMask password confirmation input.');

  const passwordTerms = page.locator(testId('create-password-terms'));
  if (await isVisible(passwordTerms, SHORT_TIMEOUT_MS).catch(() => false)) {
    await passwordTerms.check();
  }

  const passwordSubmitted = await clickFirstVisible(
    [page.locator(testId('create-password-submit')), page.getByRole('button', { name: 'Import my wallet' })],
    DEFAULT_TIMEOUT_MS,
  );
  if (!passwordSubmitted) throw new Error('Unable to submit MetaMask import password.');

  await clickFirstVisible(
    [
      page.locator(testId('onboarding-complete-done')),
      page.getByRole('button', { name: 'Done' }),
      page.getByRole('button', { name: 'Skip' }),
    ],
    DEFAULT_TIMEOUT_MS,
  );
  await waitForMetaMaskReady(page);
}

async function unlockMetaMask(page: Page, password: string) {
  const passwordFilled = await fillFirstVisible(
    [page.locator(testId('unlock-password')), page.locator('input[type="password"]').first()],
    password,
    DEFAULT_TIMEOUT_MS,
  );
  if (!passwordFilled) throw new Error('Unable to find MetaMask unlock password input.');

  const unlocked = await clickFirstVisible(
    [page.locator(testId('unlock-submit')), page.getByRole('button', { name: 'Unlock' })],
    DEFAULT_TIMEOUT_MS,
  );
  if (!unlocked) throw new Error('Unable to submit MetaMask unlock form.');
  await waitForMetaMaskReady(page);
}

class MetaMaskRealWallet implements RealWalletController {
  constructor(
    private readonly context: BrowserContext,
    private readonly homePage: Page,
    private readonly extensionId: string,
  ) {}

  async approveTokenPermission(options?: {
    gasSetting?: RealWalletGasSettings;
    spendLimit?: 'max' | number;
  }) {
    const page = await this.notificationPage();

    if (options?.spendLimit === 'max') {
      await clickFirstVisible([page.locator(testId('custom-spending-cap-max-button'))], SHORT_TIMEOUT_MS);
    } else if (typeof options?.spendLimit === 'number') {
      await fillFirstVisible(
        [page.locator(testId('custom-spending-cap-input'))],
        String(options.spendLimit),
        SHORT_TIMEOUT_MS,
      );
    }

    await this.confirmFooterAction(page);
    if (!page.isClosed()) {
      await waitForMetaMaskReady(page);
      await this.applyGasSetting(page, options?.gasSetting);
      await this.confirmFooterAction(page, SHORT_TIMEOUT_MS).catch(() => undefined);
    }
  }

  async confirmSignature() {
    const page = await this.notificationPage();
    const structuredSignButton = page.locator(testId('signature-sign-button')).first();
    const scrollButton = page.locator(testId('signature-request-scroll-button')).first();

    for (let attempts = 0; attempts < 8; attempts += 1) {
      if (!(await isVisible(scrollButton, SHORT_TIMEOUT_MS).catch(() => false))) break;
      if (await structuredSignButton.isEnabled().catch(() => false)) break;
      await scrollButton.click();
    }

    const signed = await clickFirstVisible(
      [
        page.locator(testId('request-signature__sign')),
        structuredSignButton,
        page.locator(testId('page-container-footer-next')),
        page.getByRole('button', { name: 'Sign' }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!signed) throw new Error('Unable to confirm MetaMask signature request.');

    await clickFirstVisible([page.locator(testId('signature-warning-sign-button'))], SHORT_TIMEOUT_MS);
  }

  async confirmTransaction(options?: { gasSetting?: RealWalletGasSettings }) {
    const page = await this.notificationPage();
    await this.applyGasSetting(page, options?.gasSetting);
    await clickFirstVisible(
      [page.locator('.set-approval-for-all-warning__footer__approve-button')],
      SHORT_TIMEOUT_MS,
    );
    await this.confirmFooterAction(page);
  }

  async connectToDapp(accounts?: string[]) {
    const page = await this.notificationPage();
    await this.selectAccounts(page, accounts);
    await this.confirmFooterAction(page);

    if (!page.isClosed()) {
      await waitForMetaMaskReady(page);
      await this.confirmFooterAction(page, SHORT_TIMEOUT_MS).catch(() => undefined);
    }
  }

  async getAccountAddress() {
    const page = await this.home();
    await closeMetaMaskOverlay(page);

    const openedMenu = await clickFirstVisible(
      [page.locator(testId('account-options-menu-button'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!openedMenu) throw new Error('Unable to open MetaMask account options menu.');

    const openedDetails = await clickFirstVisible(
      [page.locator(testId('account-list-menu-details'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!openedDetails) throw new Error('Unable to open MetaMask account details.');

    const addressText = page.locator(testId('address-copy-button-text')).first();
    await addressText.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
    const address = (await addressText.textContent())?.trim();
    await closeMetaMaskOverlay(page);

    if (!address?.startsWith('0x')) throw new Error('Unable to read selected MetaMask account address.');
    return address;
  }

  async rejectSignature() {
    const page = await this.notificationPage();
    await this.rejectFooterAction(page, [
      page.locator(testId('signature-cancel-button')),
      page.locator('.request-signature__footer button.btn-secondary'),
    ]);
  }

  async rejectTransaction() {
    const page = await this.notificationPage();
    await this.rejectFooterAction(page);
  }

  private async home() {
    if (!this.homePage.isClosed()) {
      await this.homePage.bringToFront().catch(() => undefined);
      await waitForMetaMaskReady(this.homePage);
      return this.homePage;
    }

    return openExtensionHome(this.context, this.extensionId);
  }

  private async notificationPage() {
    return getNotificationPage(this.context, this.extensionId);
  }

  private async confirmFooterAction(page: Page, timeout = DEFAULT_TIMEOUT_MS) {
    const confirmed = await clickFirstVisible(
      [
        page.locator(testId('confirm-footer-button')),
        page.locator(testId('confirmation-submit-button')),
        page.locator(testId('page-container-footer-next')),
        page.getByRole('button', { name: 'Confirm' }),
        page.getByRole('button', { name: 'Connect' }),
        page.getByRole('button', { name: 'Next' }),
        page.getByRole('button', { name: 'Approve' }),
      ],
      timeout,
    );
    if (!confirmed) throw new Error('Unable to confirm MetaMask notification.');
  }

  private async rejectFooterAction(page: Page, extraLocators: readonly Locator[] = []) {
    const rejected = await clickFirstVisible(
      [
        ...extraLocators,
        page.locator(testId('confirm-footer-cancel-button')),
        page.locator(testId('page-container-footer-cancel')),
        page.getByRole('button', { name: 'Reject' }),
        page.getByRole('button', { name: 'Cancel' }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!rejected) throw new Error('Unable to reject MetaMask notification.');
  }

  private async selectAccounts(page: Page, accounts?: string[]) {
    if (!accounts?.length) return;

    const rows = page.locator('.choose-account-list .choose-account-list__account');
    const rowCount = await rows.count();
    if (!rowCount) return;

    const expected = accounts.map((account) => account.toLowerCase());
    const expectedShort = accounts.map(shortAddress);

    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const text = ((await row.textContent()) ?? '').toLowerCase();
      const matches = expected.some((account) => text.includes(account)) || expectedShort.some((account) => text.includes(account));
      if (!matches) continue;

      const checkbox = row.locator('input[type="checkbox"]').first();
      if (await isVisible(checkbox, SHORT_TIMEOUT_MS).catch(() => false)) await checkbox.check();
      else await row.click();
      return;
    }

    if (rowCount > 1) {
      throw new Error(`Unable to find requested MetaMask account in connect prompt: ${accounts.join(', ')}.`);
    }
  }

  private async applyGasSetting(page: Page, gasSetting?: RealWalletGasSettings) {
    if (!gasSetting || gasSetting === 'site') return;

    const editOpened = await clickFirstVisible(
      [page.locator(testId('edit-gas-fee-icon')), page.getByRole('button', { name: 'Edit gas fee' })],
      SHORT_TIMEOUT_MS,
    );
    if (!editOpened) throw new Error('Unable to open MetaMask gas fee editor.');

    if (typeof gasSetting === 'string') {
      const testIdBySetting: Record<'aggressive' | 'low' | 'market', string> = {
        aggressive: 'edit-gas-fee-item-high',
        low: 'edit-gas-fee-item-low',
        market: 'edit-gas-fee-item-medium',
      };

      const selected = await clickFirstVisible(
        [page.locator(testId(testIdBySetting[gasSetting]))],
        DEFAULT_TIMEOUT_MS,
      );
      if (!selected) throw new Error(`Unable to select MetaMask ${gasSetting} gas setting.`);
    } else {
      const customOpened = await clickFirstVisible(
        [page.locator(testId('edit-gas-fee-item-custom'))],
        DEFAULT_TIMEOUT_MS,
      );
      if (!customOpened) throw new Error('Unable to open MetaMask custom gas editor.');

      const baseFeeFilled = await fillFirstVisible([page.locator(testId('base-fee-input'))], String(gasSetting.maxBaseFee));
      if (!baseFeeFilled) throw new Error('Unable to fill MetaMask custom base fee.');

      const priorityFeeFilled = await fillFirstVisible([page.locator(testId('priority-fee-input'))], String(gasSetting.priorityFee));
      if (!priorityFeeFilled) throw new Error('Unable to fill MetaMask custom priority fee.');

      if (gasSetting.gasLimit !== undefined) {
        const gasLimitFilled = await fillFirstVisible([page.locator(testId('gas-limit-input'))], String(gasSetting.gasLimit));
        if (!gasLimitFilled) throw new Error('Unable to fill MetaMask custom gas limit.');
      }
    }

    const saved = await clickFirstVisible(
      [page.locator('.popover-footer button.btn-primary'), page.getByRole('button', { name: 'Save' })],
      DEFAULT_TIMEOUT_MS,
    );
    if (!saved) throw new Error('Unable to save MetaMask gas setting.');
  }
}

async function prepareMetaMask({
  expectedAddress,
  page,
  setup,
  wallet,
}: {
  expectedAddress?: string;
  page: Page;
  setup?: RealWalletSetup;
  wallet: RealWalletController;
}) {
  const onboardingImport = page.locator(testId('onboarding-import-wallet'));
  const onboardingCreate = page.locator(testId('onboarding-create-wallet'));
  const onboardingTerms = page.locator(testId('onboarding-terms-checkbox'));
  if (
    (await isVisible(onboardingImport, SHORT_TIMEOUT_MS).catch(() => false)) ||
    (await isVisible(onboardingCreate, SHORT_TIMEOUT_MS).catch(() => false)) ||
    (await isVisible(onboardingTerms, SHORT_TIMEOUT_MS).catch(() => false))
  ) {
    if (!setup?.password || !setup.seedPhrase) {
      throw new Error(
        'MetaMask is on onboarding. Provide setup.password and setup.seedPhrase to import a wallet through web3-tester, or use a preconfigured persistent profile.',
      );
    }

    await importMetaMaskWallet(page, setup);
  }

  const unlockPassword = page.locator(testId('unlock-password'));
  if (await isVisible(unlockPassword, SHORT_TIMEOUT_MS).catch(() => false)) {
    if (!setup?.password) {
      throw new Error(
        'MetaMask profile is locked. Provide setup.password to unlock through web3-tester, or unlock the persistent profile before running.',
      );
    }

    await unlockMetaMask(page, setup.password);
  }

  if (!expectedAddress) return;

  const address = await wallet.getAccountAddress();
  if (address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`MetaMask account ${address} does not match expected address ${expectedAddress}.`);
  }
}

export async function launchRealWallet(options: RealWalletLaunchOptions): Promise<RealWalletSession> {
  const extensionName = options.extensionName ?? DEFAULT_EXTENSION_NAME;
  if (!fs.existsSync(options.extensionPath)) {
    throw new Error(`MetaMask extension path does not exist: ${options.extensionPath}`);
  }

  const profile = resolveRealWalletProfile(options.profileDir);
  const context = await chromium.launchPersistentContext(profile.userDataDir, {
    args: [
      ...(profile.profileDirectory ? [`--profile-directory=${profile.profileDirectory}`] : []),
      `--disable-extensions-except=${options.extensionPath}`,
      `--load-extension=${options.extensionPath}`,
    ],
    baseURL: options.baseURL,
    headless: options.headless ?? false,
    slowMo: options.slowMo,
  });

  const extensionId = await getExtensionId(context, extensionName);
  const page = await openExtensionHome(context, extensionId);
  const wallet = new MetaMaskRealWallet(context, page, extensionId);

  await prepareMetaMask({
    expectedAddress: options.expectedAddress,
    page,
    setup: options.setup,
    wallet,
  });

  return {
    approveTokenPermission: (approvalOptions) => wallet.approveTokenPermission(approvalOptions),
    close: () => context.close(),
    confirmSignature: () => wallet.confirmSignature(),
    confirmTransaction: (confirmationOptions) => wallet.confirmTransaction(confirmationOptions),
    connectToDapp: (accounts) => wallet.connectToDapp(accounts),
    context,
    extensionId,
    getAccountAddress: () => wallet.getAccountAddress(),
    rejectSignature: () => wallet.rejectSignature(),
    rejectTransaction: () => wallet.rejectTransaction(),
    wallet,
  };
}
