import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { passwordForSetup } from './real-wallet-setup.js';

export type RealWalletProfile = {
  profileDirectory?: string;
  userDataDir: string;
};

export type RealWalletSetup = {
  password?: string;
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
const LOCATOR_PROBE_MS = 250;
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

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function findVisibleLocator(
  locators: readonly Locator[],
  timeout = SHORT_TIMEOUT_MS,
  options: { requireEnabled?: boolean } = {},
) {
  const deadline = Date.now() + timeout;

  do {
    const remaining = Math.max(deadline - Date.now(), 1);
    for (const locator of locators) {
      const target = locator.first();
      const probeTimeout = Math.min(LOCATOR_PROBE_MS, remaining);
      if (!(await isVisible(target, probeTimeout).catch(() => false))) continue;
      if (options.requireEnabled && !(await target.isEnabled({ timeout: 0 }).catch(() => false))) continue;
      return target;
    }

    const delay = Math.min(LOCATOR_PROBE_MS, Math.max(deadline - Date.now(), 0));
    if (delay > 0) await wait(delay);
  } while (Date.now() < deadline);

  return undefined;
}

async function clickFirstVisible(
  locators: readonly Locator[],
  timeout = SHORT_TIMEOUT_MS,
  options: { force?: boolean; requireEnabled?: boolean } = { requireEnabled: true },
) {
  const target = await findVisibleLocator(locators, timeout, {
    requireEnabled: options.requireEnabled ?? true,
  });
  if (!target) return false;

  await target.click({ force: options.force, timeout });
  return true;
}

async function fillFirstVisible(
  locators: readonly Locator[],
  value: string,
  timeout = DEFAULT_TIMEOUT_MS,
) {
  const target = await findVisibleLocator(locators, timeout);
  if (!target) return false;

  await target.fill(value);
  return true;
}

async function startSeedPhraseWordGrid(target: Locator, firstWord: string) {
  await target.fill(firstWord);
  await wait(250);
  await target.press('Space');
}

function metaMaskOnboardingLocators(page: Page) {
  return [
    page.locator(testId('onboarding-import-wallet')),
    page.locator(testId('onboarding-import-with-srp-button')),
    page.locator(testId('onboarding-create-wallet')),
    page.locator(testId('onboarding-terms-checkbox')),
    page.locator(testId('srp-input-import__srp-note')),
    page.locator(testId('import-srp-confirm')),
    page.locator(testId('create-password-new-input')),
    page.locator(testId('create-password-confirm-input')),
    page.getByRole('button', { name: 'I have an existing wallet' }),
    page.getByRole('button', { name: 'Create a new wallet' }),
    page.getByRole('button', { name: 'Import using Secret Recovery Phrase' }),
    page.getByRole('heading', { name: 'Import a wallet' }),
  ];
}

async function isMetaMaskOnboardingVisible(page: Page) {
  return page.url().includes('/home.html#/onboarding') || Boolean(await findVisibleLocator(metaMaskOnboardingLocators(page), SHORT_TIMEOUT_MS));
}

function metaMaskSeedPhraseInputLocators(page: Page) {
  return [
    page.locator(testId('srp-input-import__srp-note')),
    page.locator('#first-word-input-text-area'),
    page.locator('textarea[name="seedPhrase"]'),
    page.locator('textarea').first(),
  ];
}

function metaMaskSeedPhraseImportLocators(page: Page) {
  return [
    ...metaMaskSeedPhraseInputLocators(page),
    page.getByRole('heading', { name: 'Import a wallet' }),
  ];
}

function metaMaskSeedPhraseWordInputs(page: Page) {
  return page.locator(
    '.srp-input-import__words-list input, input[id^="import-srp__srp-word-"], input[data-testid^="import-srp__srp-word-"], input[name^="srp-word-"]',
  );
}

async function isSeedPhraseConfirmEnabled(page: Page, timeout = SHORT_TIMEOUT_MS) {
  return Boolean(
    await findVisibleLocator([page.locator(testId('import-srp-confirm'))], timeout, {
      requireEnabled: true,
    }),
  );
}

async function fillMetaMaskSeedPhraseWordGrid(page: Page, words: readonly string[], startIndex = 0) {
  const wordInputs = metaMaskSeedPhraseWordInputs(page);

  for (let index = startIndex; index < words.length; index += 1) {
    const input = wordInputs.nth(index);
    await input.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
    await input.fill(words[index]);
    if (index < words.length - 1) {
      await input.press('Space');
      await wait(100);
    }
  }
}

async function isMetaMaskSeedPhraseImportVisible(page: Page) {
  return (
    page.url().includes('/onboarding/import-with-recovery-phrase') ||
    Boolean(await findVisibleLocator(metaMaskSeedPhraseImportLocators(page), SHORT_TIMEOUT_MS))
  );
}

async function isMetaMaskCreatePasswordVisible(page: Page) {
  return (
    page.url().includes('/onboarding/create-password') ||
    Boolean(
      await findVisibleLocator(
        [page.locator(testId('create-password-new-input')), page.locator('input[type="password"]').nth(0)],
        SHORT_TIMEOUT_MS,
      ),
    )
  );
}

async function waitForMetaMaskReady(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined);
  await isHidden(
    page.locator('.spinner, .loading-overlay, [data-testid="loading-overlay"]'),
    DEFAULT_TIMEOUT_MS,
  ).catch(() => undefined);
}

function metaMaskUnlockPasswordLocators(page: Page) {
  return [page.locator(testId('unlock-password')), page.locator('input[type="password"]').first()];
}

function metaMaskUnlockSubmitLocators(page: Page) {
  return [page.locator(testId('unlock-submit')), page.getByRole('button', { name: 'Unlock' })];
}

async function isMetaMaskUnlockVisible(page: Page) {
  return Boolean(await findVisibleLocator(metaMaskUnlockPasswordLocators(page), SHORT_TIMEOUT_MS));
}

async function closeMetaMaskOverlay(page: Page) {
  await clickFirstVisible(
    [
      page.locator(testId('popover-close')),
      page.locator('.mm-modal-content .mm-modal-header button').first(),
    ],
    SHORT_TIMEOUT_MS,
  ).catch(() => false);
}

function metaMaskAccountMenuLocators(page: Page) {
  return [
    page.locator(testId('account-options-menu-button')),
    page.locator(testId('account-menu-icon')),
    page.getByRole('button', { name: /Account options|Account menu/i }),
  ];
}

function metaMaskPromptActions(page: Page) {
  return [
    page.locator(testId('onboarding-complete-done')),
    page.locator(testId('metametrics-no-thanks')),
    page.getByRole('button', { name: 'No thanks' }),
    page.getByRole('button', { name: 'Done' }),
    page.getByRole('button', { name: 'Skip' }),
    page.getByRole('button', { name: 'Continue' }),
    page.getByRole('button', { name: 'Open wallet' }),
    page.getByRole('button', { name: 'Maybe later' }),
    page.getByRole('link', { name: 'Maybe later' }),
  ];
}

function metaMaskTextPromptActions(page: Page) {
  return [
    page.getByText('Maybe later', { exact: true }),
    page.getByText('No thanks', { exact: true }),
  ];
}

async function clickMetaMaskPromptAction(page: Page, timeout = SHORT_TIMEOUT_MS) {
  return (
    (await clickFirstVisible(metaMaskPromptActions(page), timeout)) ||
    (await clickFirstVisible(metaMaskTextPromptActions(page), timeout, { requireEnabled: false }))
  );
}

async function waitForMetaMaskHome(page: Page, timeout = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;

  do {
    await waitForMetaMaskReady(page);
    if (await findVisibleLocator(metaMaskAccountMenuLocators(page), SHORT_TIMEOUT_MS)) return true;
    if (await clickMetaMaskPromptAction(page, SHORT_TIMEOUT_MS)) continue;

    const delay = Math.min(LOCATOR_PROBE_MS, Math.max(deadline - Date.now(), 0));
    if (delay > 0) await wait(delay);
  } while (Date.now() < deadline);

  return Boolean(await findVisibleLocator(metaMaskAccountMenuLocators(page), SHORT_TIMEOUT_MS));
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
  if (page.url() !== homeUrl) await page.goto(homeUrl);
  await waitForMetaMaskReady(page);
  return page;
}

function notificationUrlPrefix(extensionId: string) {
  return extensionUrl(extensionId, 'notification.html');
}

function extensionPageUrlPrefix(extensionId: string) {
  return `chrome-extension://${extensionId}/`;
}

function metaMaskActionContentLocators(page: Page) {
  return [
    page.getByRole('heading', {
      name: /Spending cap request|Transaction request|Signature request|Sign-in request|Permission request/i,
    }),
    page.getByText(
      /Spending cap request|Transaction request|Signature request|Sign-in request|Permission request|This site wants permission/i,
    ),
  ];
}

function metaMaskActionControlLocators(page: Page) {
  return [
    page.locator(testId('confirm-footer-button')),
    page.locator(testId('confirmation-submit-button')),
    page.locator(testId('page-container-footer-next')),
    page.locator(testId('request-signature__sign')),
    page.locator(testId('signature-sign-button')),
    page.locator(testId('custom-spending-cap-input')),
    page.locator('.set-approval-for-all-warning__footer__approve-button'),
    page.getByRole('button', { name: /^(Confirm|Connect|Next|Approve|Sign)$/i }),
  ];
}

function metaMaskActionLocators(page: Page) {
  return [...metaMaskActionContentLocators(page), ...metaMaskActionControlLocators(page)];
}

async function findMetaMaskActionPage(context: BrowserContext, extensionId: string) {
  const extensionPrefix = extensionPageUrlPrefix(extensionId);
  let controlOnlyPage: Page | undefined;

  for (const page of [...context.pages()].reverse()) {
    if (page.isClosed() || !page.url().startsWith(extensionPrefix)) continue;
    await page.waitForLoadState('domcontentloaded', { timeout: LOCATOR_PROBE_MS }).catch(() => undefined);

    if (await findVisibleLocator(metaMaskActionContentLocators(page), LOCATOR_PROBE_MS, { requireEnabled: false })) {
      return page;
    }

    if (
      !controlOnlyPage &&
      (await findVisibleLocator(metaMaskActionControlLocators(page), LOCATOR_PROBE_MS, { requireEnabled: false }))
    ) {
      controlOnlyPage = page;
    }
  }

  return controlOnlyPage;
}

async function findMetaMaskLockedPage(context: BrowserContext, extensionId: string) {
  const extensionPrefix = extensionPageUrlPrefix(extensionId);

  for (const page of [...context.pages()].reverse()) {
    if (page.isClosed() || !page.url().startsWith(extensionPrefix)) continue;
    await page.waitForLoadState('domcontentloaded', { timeout: LOCATOR_PROBE_MS }).catch(() => undefined);
    if (await isMetaMaskUnlockVisible(page)) return page;
  }

  return undefined;
}

function findMetaMaskNotificationPage(context: BrowserContext, extensionId: string) {
  const notificationPrefix = notificationUrlPrefix(extensionId);
  return [...context.pages()]
    .reverse()
    .find((page) => !page.isClosed() && page.url().startsWith(notificationPrefix));
}

async function getNotificationPage(context: BrowserContext, extensionId: string, timeout = DEFAULT_TIMEOUT_MS) {
  const prefix = notificationUrlPrefix(extensionId);
  const extensionPrefix = extensionPageUrlPrefix(extensionId);
  const startedAt = Date.now();
  let page = await findMetaMaskActionPage(context, extensionId);
  let notificationPage = findMetaMaskNotificationPage(context, extensionId);

  while (!page && Date.now() - startedAt < timeout) {
    const remaining = Math.max(timeout - (Date.now() - startedAt), 1_000);
    const candidate = await context.waitForEvent('page', { timeout: Math.min(remaining, 1_000) }).catch(() => undefined);

    if (candidate) {
      await candidate
        .waitForURL((url) => url.href.startsWith(prefix) || url.href.startsWith(extensionPrefix), {
          timeout: Math.min(remaining, 5_000),
        })
        .catch(() => undefined);
    }

    page = await findMetaMaskActionPage(context, extensionId);
    notificationPage = findMetaMaskNotificationPage(context, extensionId) ?? notificationPage;
  }

  page ??= notificationPage;
  if (!page) throw new Error('Timed out waiting for MetaMask notification window.');
  await waitForMetaMaskReady(page);
  await page.bringToFront().catch(() => undefined);
  return page;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`.toLowerCase();
}

async function pageContainsAddress(page: Page, address: string) {
  const normalizedAddress = address.toLowerCase();
  const text = ((await page.locator('body').textContent({ timeout: SHORT_TIMEOUT_MS }).catch(() => '')) ?? '')
    .replace(/\s+/g, '')
    .toLowerCase();

  return (
    text.includes(normalizedAddress) ||
    (text.includes(normalizedAddress.slice(0, 6)) && text.includes(normalizedAddress.slice(-4))) ||
    (text.includes(normalizedAddress.slice(0, 7)) && text.includes(normalizedAddress.slice(-5)))
  );
}

async function fillSeedPhrase(page: Page, seedPhrase: string) {
  const words = seedPhrase.trim().split(/\s+/);
  if (words.length < 12) {
    throw new Error('setup.seedPhrase must contain at least 12 words.');
  }

  const singleInput = await findVisibleLocator(metaMaskSeedPhraseInputLocators(page), DEFAULT_TIMEOUT_MS);
  if (singleInput) {
    await startSeedPhraseWordGrid(singleInput, words[0]);
    await fillMetaMaskSeedPhraseWordGrid(page, words, 1);
    if (await isSeedPhraseConfirmEnabled(page)) {
      return;
    }
  }

  const wordInputs = metaMaskSeedPhraseWordInputs(page);
  if ((await wordInputs.count()) >= words.length) {
    await fillMetaMaskSeedPhraseWordGrid(page, words);
    if (await isSeedPhraseConfirmEnabled(page)) return;
  }

  const textboxes = page.getByRole('textbox');
  if ((await textboxes.count()) >= words.length) {
    for (const [index, word] of words.entries()) {
      await textboxes.nth(index).fill(word);
    }
    return;
  }

  throw new Error('Unable to find MetaMask seed phrase input fields.');
}

async function importMetaMaskWallet(page: Page, setup: RealWalletSetup) {
  const password = passwordForSetup(setup);
  if (!password || !setup.seedPhrase) {
    throw new Error(
      'MetaMask is on onboarding. Provide setup.seedPhrase to import a wallet through web3-tester, or use a preconfigured persistent profile.',
    );
  }

  await page.bringToFront().catch(() => undefined);

  const terms = page.locator(testId('onboarding-terms-checkbox'));
  if (await isVisible(terms, SHORT_TIMEOUT_MS).catch(() => false)) {
    await terms.check();
  }

  if (!(await isMetaMaskSeedPhraseImportVisible(page)) && !(await isMetaMaskCreatePasswordVisible(page))) {
    const importStarted = await clickFirstVisible(
      [
        page.locator(testId('onboarding-import-wallet')),
        page.locator(testId('onboarding-import-with-srp-button')),
        page.getByRole('button', { name: 'I have an existing wallet' }),
        page.getByRole('button', { name: 'Import an existing wallet' }),
        page.getByRole('button', { name: 'Import wallet' }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!importStarted) throw new Error('Unable to start MetaMask wallet import flow.');

    await waitForMetaMaskReady(page);
    await clickFirstVisible(
      [
        page.locator(testId('onboarding-import-with-srp-button')),
        page.getByRole('button', { name: 'Import using Secret Recovery Phrase' }),
      ],
      5_000,
    );

    await clickFirstVisible(
      [
        page.locator(testId('metametrics-no-thanks')),
        page.locator(testId('metametrics-i-agree')),
        page.getByRole('button', { name: 'No thanks' }),
        page.getByRole('button', { name: 'I agree' }),
      ],
      SHORT_TIMEOUT_MS,
    );
  }

  if (!(await isMetaMaskCreatePasswordVisible(page))) {
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
  }

  const passwordFilled = await fillFirstVisible(
    [page.locator(testId('create-password-new-input')), page.locator('input[type="password"]').nth(0)],
    password,
  );
  if (!passwordFilled) throw new Error('Unable to find MetaMask password input.');

  const confirmationPasswordFilled = await fillFirstVisible(
    [page.locator(testId('create-password-confirm-input')), page.locator('input[type="password"]').nth(1)],
    password,
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

  await finishMetaMaskOnboarding(page);
}

async function unlockMetaMask(page: Page, password: string) {
  const passwordFilled = await fillFirstVisible(metaMaskUnlockPasswordLocators(page), password, DEFAULT_TIMEOUT_MS);
  if (!passwordFilled) throw new Error('Unable to find MetaMask unlock password input.');

  const unlocked = await clickFirstVisible(metaMaskUnlockSubmitLocators(page), DEFAULT_TIMEOUT_MS);
  if (!unlocked) throw new Error('Unable to submit MetaMask unlock form.');
  await waitForMetaMaskReady(page);
}

async function unlockMetaMaskIfNeeded(page: Page, password: string | undefined) {
  if (!(await isMetaMaskUnlockVisible(page))) return false;
  if (!password) {
    throw new Error(
      'MetaMask profile is locked. Provide setup.password to unlock through web3-tester, or unlock the persistent profile before running.',
    );
  }

  await page.bringToFront().catch(() => undefined);
  await unlockMetaMask(page, password);
  return true;
}

async function finishMetaMaskOnboarding(page: Page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await waitForMetaMaskReady(page);
    const actions = [...metaMaskPromptActions(page), ...metaMaskTextPromptActions(page)];
    const onSetupScreen =
      page.url().includes('/home.html#/onboarding') ||
      Boolean(await findVisibleLocator(actions, SHORT_TIMEOUT_MS));
    if (!onSetupScreen) return;

    const advanced = await clickMetaMaskPromptAction(page, 5_000);
    if (!advanced) break;
  }

  if (await waitForMetaMaskHome(page, 10_000)) return;
  if (
    page.url().includes('/home.html#/onboarding') ||
    (await findVisibleLocator([...metaMaskPromptActions(page), ...metaMaskTextPromptActions(page)], SHORT_TIMEOUT_MS))
  ) {
    throw new Error('MetaMask wallet import did not complete onboarding.');
  }
}

class MetaMaskRealWallet implements RealWalletController {
  constructor(
    private readonly context: BrowserContext,
    private readonly homePage: Page,
    private readonly extensionId: string,
    private readonly expectedAddress?: string,
    private readonly walletPassword?: string,
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
        page.locator(testId('confirm-footer-button')),
        page.locator(testId('confirmation-submit-button')),
        page.locator(testId('request-signature__sign')),
        structuredSignButton,
        page.locator(testId('page-container-footer-next')),
        page.getByRole('button', { name: 'Confirm' }),
        page.getByRole('button', { name: 'Sign' }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!signed) throw new Error('Unable to confirm MetaMask signature request.');

    await clickFirstVisible([page.locator(testId('signature-warning-sign-button'))], SHORT_TIMEOUT_MS);
  }

  async confirmTransaction(options?: { gasSetting?: RealWalletGasSettings }) {
    let page = await this.notificationPage();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.applyGasSetting(page, options?.gasSetting);
      await clickFirstVisible(
        [page.locator('.set-approval-for-all-warning__footer__approve-button')],
        SHORT_TIMEOUT_MS,
      );
      await this.confirmFooterAction(page);

      await wait(1_000);
      const nextPage = await findMetaMaskActionPage(this.context, this.extensionId);
      if (!nextPage) return;

      page = nextPage;
      await waitForMetaMaskReady(page);
      await page.bringToFront().catch(() => undefined);
    }

    throw new Error('MetaMask transaction confirmation did not settle after multiple confirmation steps.');
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
    await waitForMetaMaskHome(page);
    await closeMetaMaskOverlay(page);
    if (this.expectedAddress && await pageContainsAddress(page, this.expectedAddress)) {
      return this.expectedAddress;
    }

    const openedMenu = await clickFirstVisible(
      metaMaskAccountMenuLocators(page),
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
    const page = await openExtensionHome(this.context, this.extensionId);
    await unlockMetaMaskIfNeeded(page, this.walletPassword);
    return page;
  }

  private async notificationPage() {
    await this.unlockVisibleMetaMask();

    let page = await getNotificationPage(this.context, this.extensionId).catch(async (error: unknown) => {
      if (await this.unlockVisibleMetaMask()) {
        return getNotificationPage(this.context, this.extensionId);
      }
      throw error;
    });

    if (await unlockMetaMaskIfNeeded(page, this.walletPassword)) {
      page = await getNotificationPage(this.context, this.extensionId);
    }

    return page;
  }

  private async unlockVisibleMetaMask() {
    const page = await findMetaMaskLockedPage(this.context, this.extensionId);
    if (!page) return false;
    return unlockMetaMaskIfNeeded(page, this.walletPassword);
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
  if (await isMetaMaskOnboardingVisible(page)) {
    if (!setup?.seedPhrase) {
      throw new Error(
        'MetaMask is on onboarding. Provide setup.seedPhrase to import a wallet through web3-tester, or use a preconfigured persistent profile.',
      );
    }

    await importMetaMaskWallet(page, setup);
  }

  await unlockMetaMaskIfNeeded(page, passwordForSetup(setup));

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
  const wallet = new MetaMaskRealWallet(
    context,
    page,
    extensionId,
    options.expectedAddress,
    passwordForSetup(options.setup),
  );

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
