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

export type RealWalletNetwork = {
  name: string;
  rpcUrl: string;
  chainId: number;
  symbol: string;
  blockExplorerUrl?: string;
};

export type RealWalletToken = {
  /** ERC-20 contract address (0x + 40 hex). */
  address: string;
  /** Optional symbol override; MetaMask usually autofills from the contract. */
  symbol?: string;
  /** Optional decimals override. */
  decimals?: number;
  /**
   * 13.x only: network to import the token on (name as shown in the import
   * modal's network selector). Defaults to the wallet's active network.
   */
  networkName?: string;
};

export type RealWalletController = {
  addNetwork(network: RealWalletNetwork): Promise<void>;
  approveNewNetwork(): Promise<void>;
  approveSwitchNetwork(): Promise<void>;
  approveTokenPermission(options?: {
    gasSetting?: RealWalletGasSettings;
    spendLimit?: 'max' | number;
  }): Promise<void>;
  confirmSignature(): Promise<void>;
  confirmTransaction(options?: { gasSetting?: RealWalletGasSettings }): Promise<void>;
  connectToDapp(accounts?: string[]): Promise<void>;
  getAccountAddress(): Promise<string>;
  rejectNewNetwork(): Promise<void>;
  rejectSignature(): Promise<void>;
  rejectSwitchNetwork(): Promise<void>;
  rejectTokenPermission(): Promise<void>;
  rejectTransaction(): Promise<void>;
  switchNetwork(name: string, options?: { chainId?: number }): Promise<void>;
  /** Creates the next derived account on the active SRP, optionally named. */
  addNewAccount(name?: string): Promise<void>;
  /** Synpress-parity alias for approveAddToken(). */
  addNewToken(): Promise<void>;
  /** Approves a pending wallet_watchAsset ("Add suggested tokens") prompt. */
  approveAddToken(): Promise<void>;
  rejectAddToken(): Promise<void>;
  /**
   * confirmTransaction, then watch the newest activity row until confirmed.
   * The hash is read best-effort via "Copy transaction ID" — undefined when
   * the clipboard read fails (the mining wait still completes).
   */
  confirmTransactionAndWaitForMining(options?: {
    gasSetting?: RealWalletGasSettings;
    /** Wait budget for the activity row to reach confirmed. Default 60_000. */
    timeoutMs?: number;
  }): Promise<{ txHash?: `0x${string}` }>;
  /** Manual token import: tokens tab → Import tokens → Custom token form. */
  importToken(token: RealWalletToken): Promise<void>;
  /** Imports a private-key account ("Imported" keyring); throws on MetaMask errors (e.g. duplicates). */
  importWalletFromPrivateKey(privateKey: string): Promise<void>;
  /** Global menu → Lock; resolves once the unlock screen is visible. */
  lock(): Promise<void>;
  renameAccount(currentName: string, newName: string): Promise<void>;
  /** Clears activity/nonce data (12.x: Advanced; 13.x: Developer tools). */
  resetAccount(): Promise<void>;
  /** Selects an account in the picker by display name or (best-effort on 13.x) address. */
  switchAccount(nameOrAddress: string): Promise<void>;
  /** Idempotent when `on` is given (reads the toggle first); blind toggle when omitted. */
  toggleShowTestNetworks(on?: boolean): Promise<void>;
  /** Unlocks with the given password or the password from launch setup. */
  unlock(password?: string): Promise<void>;
};

export type RealWalletSession = RealWalletController & {
  close(): Promise<void>;
  context: BrowserContext;
  extensionId: string;
  wallet: RealWalletController;
};

const DEFAULT_EXTENSION_NAME = 'MetaMask';
const DEFAULT_TIMEOUT_MS = 30_000;
const SHORT_TIMEOUT_MS = 2_000;
const LOCATOR_PROBE_MS = 250;
const FULL_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
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
): Promise<Locator | undefined> {
  const target = await findVisibleLocator(locators, timeout, {
    requireEnabled: options.requireEnabled ?? true,
  });
  if (!target) return undefined;

  await target.click({ force: options.force, timeout });
  return target;
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

// MetaMask 12.x routes are home.html#onboarding/..., 13.x uses #/onboarding/...
const isOnboardingRoute = (url: string) => /home\.html#\/?onboarding/.test(url);

function metaMaskOnboardingLocators(page: Page) {
  return [
    page.locator(testId('onboarding-get-started-button')),
    page.locator(testId('onboarding-welcome-banner-title')),
    page.locator(testId('onboarding-import-wallet')),
    page.locator(testId('onboarding-import-with-srp-button')),
    page.locator(testId('onboarding-create-wallet')),
    page.locator(testId('onboarding-terms-checkbox')),
    page.locator(testId('srp-input-import__srp-note')),
    page.locator(testId('import-srp-confirm')),
    page.locator(testId('create-password-new-input')),
    page.locator(testId('create-password-confirm-input')),
    page.getByRole('button', { name: 'Get started' }),
    page.getByRole('button', { name: 'I have an existing wallet' }),
    page.getByRole('button', { name: 'Create a new wallet' }),
    page.getByRole('button', { name: 'Import using Secret Recovery Phrase' }),
    page.getByRole('heading', { name: 'Import a wallet' }),
  ];
}

async function isMetaMaskOnboardingVisible(page: Page) {
  return isOnboardingRoute(page.url()) || Boolean(await findVisibleLocator(metaMaskOnboardingLocators(page), SHORT_TIMEOUT_MS));
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
    /#\/?onboarding\/import-with-recovery-phrase/.test(page.url()) ||
    Boolean(await findVisibleLocator(metaMaskSeedPhraseImportLocators(page), SHORT_TIMEOUT_MS))
  );
}

async function isMetaMaskCreatePasswordVisible(page: Page) {
  return (
    /#\/?onboarding\/create-password/.test(page.url()) ||
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
  // Dismiss stacked overlays ("what's new" modals, popovers) that intercept
  // pointer events over the whole home screen.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const closed = await clickFirstVisible(
      [
        page.locator(testId('not-now-button')),
        page.locator(testId('popover-close')),
        page.locator('.mm-modal-content button[aria-label="Close"]'),
        page.locator('.mm-modal-content .mm-modal-header button').first(),
      ],
      SHORT_TIMEOUT_MS,
    ).catch(() => undefined);
    if (!closed) return;
    await wait(250);
  }
}

function metaMaskNetworkPickerLocators(page: Page) {
  return [
    page.locator(testId('network-display')),
    page.locator(testId('sort-by-networks')),
    page.getByRole('button', { name: /select a network|network menu/i }),
  ];
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
      name: /Spending cap request|Transaction request|Signature request|Sign-in request|Permission request|Add suggested tokens?/i,
    }),
    page.getByText(
      /Spending cap request|Transaction request|Signature request|Sign-in request|Permission request|This site wants permission|Add suggested tokens?/i,
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
  // MetaMask suppresses its popup window when extension tabs are already
  // open; after a short grace period for a spontaneous popup, open
  // notification.html ourselves — pending confirmations render there.
  const forceAt = startedAt + Math.min(5_000, timeout / 2);
  let forcedPage: Page | undefined;
  let page = await findMetaMaskActionPage(context, extensionId);

  while (!page && Date.now() - startedAt < timeout) {
    const remaining = Math.max(timeout - (Date.now() - startedAt), 1_000);

    if (!forcedPage && Date.now() >= forceAt) {
      forcedPage = await context.newPage();
      await forcedPage.goto(extensionUrl(extensionId, 'notification.html')).catch(() => undefined);
      await waitForMetaMaskReady(forcedPage);
    } else {
      const candidate = await context.waitForEvent('page', { timeout: Math.min(remaining, 1_000) }).catch(() => undefined);
      if (candidate) {
        await candidate
          .waitForURL((url) => url.href.startsWith(prefix) || url.href.startsWith(extensionPrefix), {
            timeout: Math.min(remaining, 5_000),
          })
          .catch(() => undefined);
      }
    }

    page = await findMetaMaskActionPage(context, extensionId);
  }

  // Last resort: any notification.html page (including the forced one) even
  // if the action-content matchers did not recognize the confirmation copy.
  page ??= findMetaMaskNotificationPage(context, extensionId);

  if (!page) {
    await forcedPage?.close().catch(() => undefined);
    throw new Error('Timed out waiting for MetaMask notification window.');
  }
  if (forcedPage && forcedPage !== page && !forcedPage.isClosed()) {
    await forcedPage.close().catch(() => undefined);
  }
  await waitForMetaMaskReady(page);
  await page.bringToFront().catch(() => undefined);
  return page;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`.toLowerCase();
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @internal Validates and trims a 32-byte hex private key (0x optional). */
export function normalizePrivateKey(privateKey: string): string {
  const trimmed = privateKey.trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      'importWalletFromPrivateKey requires a 32-byte hex private key (with or without 0x).',
    );
  }
  return trimmed;
}

/** @internal */
export function isFullTxHash(value: string | undefined): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * @internal Matches an account picker row by display name, or by full /
 * shortened address when the identifier is an address.
 */
export function accountRowMatcher(identifier: string): RegExp {
  if (FULL_ADDRESS_PATTERN.test(identifier)) {
    return new RegExp(`${escapeRegExp(identifier)}|${escapeRegExp(shortAddress(identifier))}`, 'i');
  }
  return new RegExp(escapeRegExp(identifier), 'i');
}

// Account picker rows across UI generations: 12.x popover items, 13.x
// multichain account cells.
function accountRowLocator(page: Page) {
  return page.locator(
    '.multichain-account-menu-popover__list--menu-item, .multichain-account-cell, .multichain-account-list-item',
  );
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

  // 12.23+ shows a welcome interstitial followed by a Terms of Use dialog
  // (scroll to bottom, check, agree) before the create/import choice.
  await clickFirstVisible([page.locator(testId('onboarding-get-started-button'))], SHORT_TIMEOUT_MS);
  const termsOfUseCheckbox = page.locator(testId('terms-of-use-checkbox'));
  if (await isVisible(termsOfUseCheckbox, SHORT_TIMEOUT_MS).catch(() => false)) {
    await clickFirstVisible([page.locator(testId('terms-of-use-scroll-button'))], SHORT_TIMEOUT_MS);
    await termsOfUseCheckbox.click();
    const agreed = await clickFirstVisible(
      [page.locator(testId('terms-of-use-agree-button'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!agreed) throw new Error('Unable to accept the MetaMask Terms of Use.');
    await waitForMetaMaskReady(page);
  }

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

  await finishMetaMaskOnboarding(page, password);
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

async function finishMetaMaskOnboarding(page: Page, password: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await waitForMetaMaskReady(page);
    const actions = [...metaMaskPromptActions(page), ...metaMaskTextPromptActions(page)];
    const onSetupScreen =
      isOnboardingRoute(page.url()) ||
      Boolean(await findVisibleLocator(actions, SHORT_TIMEOUT_MS));
    if (!onSetupScreen) break;

    const advanced = await clickMetaMaskPromptAction(page, 5_000);
    if (!advanced) break;
  }

  // MetaMask 13.x defaults to opening the wallet in Chrome's side panel, so
  // clicking "Open wallet" disables the button and leaves the onboarding tab
  // parked on #/onboarding/completion (Playwright can't drive the side
  // panel). Route the tab to the wallet home ourselves.
  if (isOnboardingRoute(page.url())) {
    const homeUrl = page.url().split('#')[0];
    await page.goto(homeUrl).catch(() => undefined);
    await waitForMetaMaskReady(page);
    // Navigating away from completion can re-lock the freshly created vault.
    await unlockMetaMaskIfNeeded(page, password);
  }

  if (!(await waitForMetaMaskHome(page, DEFAULT_TIMEOUT_MS))) {
    throw new Error('MetaMask wallet import did not complete onboarding.');
  }

  // MetaMask 13.x persists state to IndexedDB asynchronously with a debounced
  // write. The vault and completedOnboarding flag only reach disk once the
  // wallet has sat on a working home screen for a moment — closing/relaunching
  // the profile before then silently replays onboarding. Dwell to let the
  // write flush before the caller tears the context down.
  await page.waitForTimeout(3_000);
}

class MetaMaskRealWallet implements RealWalletController {
  constructor(
    private readonly context: BrowserContext,
    private readonly homePage: Page,
    private readonly extensionId: string,
    // Mutable: account mutations (switchAccount, imports, new accounts) must
    // invalidate it, or getAccountAddress's fast-path returns stale results.
    private expectedAddress?: string,
    private readonly walletPassword?: string,
  ) {}

  async approveTokenPermission(options?: {
    gasSetting?: RealWalletGasSettings;
    spendLimit?: 'max' | number;
  }) {
    const page = await this.notificationPage();

    if (options?.spendLimit === 'max') {
      const clicked = await clickFirstVisible(
        [page.locator(testId('custom-spending-cap-max-button'))],
        SHORT_TIMEOUT_MS,
      );
      if (!clicked) {
        throw new Error(
          'A max spendLimit was requested but the MetaMask spending-cap "Max" control was not found.',
        );
      }
    } else if (typeof options?.spendLimit === 'number') {
      const filled = await fillFirstVisible(
        [page.locator(testId('custom-spending-cap-input'))],
        String(options.spendLimit),
        SHORT_TIMEOUT_MS,
      );
      if (!filled) {
        throw new Error(
          'A numeric spendLimit was requested but the MetaMask spending-cap input was not found.',
        );
      }
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
      const clicked = await this.confirmFooterAction(page);

      // The click registered once the confirmed control leaves the view or
      // the popup closes — no fixed sleep deciding "settled".
      await Promise.race([
        clicked.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined),
        page.waitForEvent('close', { timeout: 10_000 }).catch(() => undefined),
      ]);

      if (!page.isClosed()) {
        // Same window advanced to another confirmation step.
        const nextStep = await findVisibleLocator(metaMaskActionLocators(page), SHORT_TIMEOUT_MS, {
          requireEnabled: false,
        });
        if (!nextStep) return;
        await waitForMetaMaskReady(page);
        continue;
      }

      // Popup closed: give a follow-up notification window (approve + action
      // flows) a moment to appear.
      const deadline = Date.now() + 1_500;
      let nextPage: Page | undefined;
      while (Date.now() < deadline && !nextPage) {
        nextPage = await findMetaMaskActionPage(this.context, this.extensionId);
        if (!nextPage) await wait(LOCATOR_PROBE_MS);
      }
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

    // Some MetaMask builds (12.x) expose a header copy button that puts the
    // full address on the clipboard; reading it via a synthetic paste avoids
    // the account-details modal entirely (extension pages block evaluate via
    // LavaMoat, normal pages do not).
    const headerCopied = await clickFirstVisible(
      [page.locator(testId('app-header-copy-button'))],
      SHORT_TIMEOUT_MS,
    );
    if (headerCopied) {
      const pasted = await this.readClipboardViaPaste();
      if (pasted && FULL_ADDRESS_PATTERN.test(pasted)) return pasted;
    }

    await this.openAccountDetailsModal(page);

    // Read the full address from whichever copy affordance the modal exposes
    // (12.x: address-copy-button-text; 13.x addresses view:
    // multichain-address-row-copy-button). The visible text may be shortened,
    // so prefer clicking the copy control and reading the clipboard.
    const addressCopy = await findVisibleLocator(
      [
        page.locator(testId('address-copy-button-text')),
        page.locator(testId('multichain-address-row-copy-button')),
        page.locator(testId('address-qr-code-modal-copy-button')),
      ],
      DEFAULT_TIMEOUT_MS,
      { requireEnabled: false },
    );
    if (!addressCopy) {
      throw new Error('Unable to find the MetaMask account address in the details view.');
    }

    const elementText = (await addressCopy.textContent())?.trim();
    if (elementText && FULL_ADDRESS_PATTERN.test(elementText)) {
      await closeMetaMaskOverlay(page);
      return elementText;
    }

    await addressCopy.click().catch(() => undefined);
    const pasted = await this.readClipboardViaPaste();
    await closeMetaMaskOverlay(page);
    if (pasted && FULL_ADDRESS_PATTERN.test(pasted)) {
      return pasted;
    }

    throw new Error('Unable to read the selected MetaMask account address from the UI.');
  }

  // Opens the account address view across MetaMask UI generations. 12.x:
  // account-options (3-dot) menu -> "Account details". 13.x multichain UI:
  // account picker -> the selected account row's address menu -> "Addresses"
  // (the "Account details" item there is the export-keys view, not the
  // address).
  private async openAccountDetailsModal(page: Page) {
    // 12.x path.
    if (await clickFirstVisible([page.locator(testId('account-options-menu-button'))], SHORT_TIMEOUT_MS)) {
      if (await clickFirstVisible([page.locator(testId('account-list-menu-details'))], SHORT_TIMEOUT_MS)) {
        return;
      }
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    // 13.x multichain path. Prefer the home header's active-account address
    // menu (default-address-menu-button) so we read the *selected* account
    // rather than an arbitrary cell — a single SRP import derives many
    // accounts whose picker order does not start at the active one.
    let addressMenuOpened = await clickFirstVisible(
      [page.locator(testId('default-address-menu-button'))],
      SHORT_TIMEOUT_MS,
    );

    if (!addressMenuOpened) {
      const pickerOpened = await clickFirstVisible(
        [page.locator(testId('account-menu-icon'))],
        DEFAULT_TIMEOUT_MS,
      );
      if (!pickerOpened) throw new Error('Unable to open the MetaMask account picker.');

      const expected = this.expectedAddress?.toLowerCase();
      const selectedRow = expected
        ? page
            .locator('[data-testid^="multichain-account-cell"]')
            .filter({ hasText: new RegExp(`${expected.slice(0, 6)}|${shortAddress(expected)}`, 'i') })
            .first()
        : page.locator('[data-testid^="multichain-account-cell"]').first();

      addressMenuOpened =
        (await clickFirstVisible(
          [selectedRow.locator(testId('multichain-account-cell-end-accessory'))],
          DEFAULT_TIMEOUT_MS,
        )) ??
        (await clickFirstVisible(
          [page.getByRole('button', { name: 'Open multichain account address menu' }).first()],
          SHORT_TIMEOUT_MS,
        ));
    }
    if (!addressMenuOpened) throw new Error('Unable to open the MetaMask account address menu.');

    const detailsOpened = await clickFirstVisible(
      [
        page.locator(testId('multichain-account-menu-item-addresses')),
        page.getByRole('menuitem', { name: /^Addresses$/i }),
        page.getByText('Addresses', { exact: true }),
        page.locator(testId('multichain-account-menu-item-accountDetails')),
        page.locator(testId('account-list-menu-details')),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!detailsOpened) throw new Error('Unable to open the MetaMask account address view.');
  }

  private async readClipboardViaPaste(): Promise<string | undefined> {
    const page = await this.context.newPage();
    try {
      await page.goto('data:text/html,<input id="paste-target" autofocus>');
      const input = page.locator('#paste-target');
      await input.click();
      await page.keyboard.press('ControlOrMeta+v');
      const value = (await input.inputValue()).trim();
      return value || undefined;
    } catch {
      return undefined;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async addNetwork(network: RealWalletNetwork) {
    const page = await this.home();
    await waitForMetaMaskHome(page);
    await closeMetaMaskOverlay(page);

    const pickerOpened = await clickFirstVisible(
      metaMaskNetworkPickerLocators(page),
      DEFAULT_TIMEOUT_MS,
    );
    if (!pickerOpened) throw new Error('Unable to open the MetaMask network picker.');

    // 13.x splits the picker into "Default"/popular and "Custom" tabs; the
    // custom RPC form lives behind the Custom tab. (The bare "Add network"
    // buttons on the default tab add preconfigured popular networks, not a
    // custom RPC.) Selecting the tab is a no-op on 12.x. The modal animates
    // in, so give the click room to stabilize.
    await wait(300);
    await clickFirstVisible([page.getByRole('tab', { name: /^Custom$/i })], 8_000);

    const addStarted = await clickFirstVisible(
      [
        page.locator(testId('network-list-menu-add-button')),
        page.getByRole('button', { name: /Add a custom network|Add custom network/i }),
        page.getByText(/Add a custom network/i),
        page.getByRole('button', { name: /^Add network$/i }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!addStarted) throw new Error('Unable to start the MetaMask add-network flow.');

    // Versions that list popular networks first need one more hop.
    await clickFirstVisible(
      [page.locator(testId('add-network-manually')), page.getByText(/Add a network manually/i)],
      SHORT_TIMEOUT_MS,
    );

    const nameFilled = await fillFirstVisible(
      [page.locator(testId('network-form-network-name')), page.locator('input[name="networkName"]')],
      network.name,
    );
    if (!nameFilled) throw new Error('Unable to fill the MetaMask network name field.');

    // RPC URL: newer MetaMask uses a dropdown with a dedicated add-RPC form;
    // older versions render a plain input.
    const rpcDirect = await fillFirstVisible(
      [page.locator(testId('network-form-rpc-url')), page.locator('input[name="rpcUrl"]')],
      network.rpcUrl,
      SHORT_TIMEOUT_MS,
    );
    if (!rpcDirect) {
      const dropdownOpened = await clickFirstVisible(
        [page.locator(testId('test-add-rpc-drop-down')), page.getByText(/Add RPC URL/i)],
        SHORT_TIMEOUT_MS,
      );
      if (!dropdownOpened) throw new Error('Unable to find the MetaMask RPC URL input.');

      await clickFirstVisible(
        [page.getByRole('button', { name: /Add RPC URL/i })],
        SHORT_TIMEOUT_MS,
      );

      const rpcFilled = await fillFirstVisible(
        [page.locator(testId('rpc-url-input-test')), page.locator('input[name="rpcUrl"]')],
        network.rpcUrl,
      );
      if (!rpcFilled) throw new Error('Unable to fill the MetaMask RPC URL field.');

      const rpcConfirmed = await clickFirstVisible(
        [page.getByRole('button', { name: /^Add URL$/i })],
        SHORT_TIMEOUT_MS,
      );
      if (!rpcConfirmed) throw new Error('Unable to confirm the MetaMask RPC URL.');
    }

    const chainFilled = await fillFirstVisible(
      [page.locator(testId('network-form-chain-id')), page.locator('input[name="chainId"]')],
      String(network.chainId),
    );
    if (!chainFilled) throw new Error('Unable to fill the MetaMask chain id field.');

    const symbolFilled = await fillFirstVisible(
      [page.locator(testId('network-form-ticker-input')), page.locator('input[name="symbol"]')],
      network.symbol,
    );
    if (!symbolFilled) throw new Error('Unable to fill the MetaMask currency symbol field.');

    if (network.blockExplorerUrl) {
      await fillFirstVisible(
        [
          page.locator(testId('network-form-block-explorer-url')),
          page.locator('input[name="blockExplorerUrl"]'),
        ],
        network.blockExplorerUrl,
        SHORT_TIMEOUT_MS,
      );
    }

    const saved = await clickFirstVisible(
      [page.locator(testId('network-form-save')), page.getByRole('button', { name: /^Save$/i })],
      DEFAULT_TIMEOUT_MS,
    );
    if (!saved) {
      throw new Error(
        'Unable to save the MetaMask network. Note that 13.x refuses custom networks under a ' +
          'known chain id ("edit the original network") — add those via a dapp ' +
          'wallet_addEthereumChain request plus approveNewNetwork() instead.',
      );
    }

    await waitForMetaMaskReady(page);
    await clickMetaMaskPromptAction(page, SHORT_TIMEOUT_MS);
    await closeMetaMaskOverlay(page);
  }

  async switchNetwork(name: string, options: { chainId?: number } = {}) {
    const page = await this.home();
    await waitForMetaMaskHome(page);
    await closeMetaMaskOverlay(page);

    const pickerOpened = await clickFirstVisible(
      metaMaskNetworkPickerLocators(page),
      DEFAULT_TIMEOUT_MS,
    );
    if (!pickerOpened) throw new Error('Unable to open the MetaMask network picker.');

    const candidates = () => [
      // 13.x multichain rows are keyed by CAIP-2 chain id.
      ...(options.chainId !== undefined
        ? [page.locator(testId(`network-list-item-eip155:${options.chainId}`))]
        : []),
      // 12.x rows have historically used the network name as test id.
      page.locator(testId(name)),
      page.locator('[data-testid="network-list-item"]').filter({ hasText: name }),
      page.locator('[data-testid^="network-list-item"]').filter({ hasText: name }),
      page.locator('.multichain-network-list-item').filter({ hasText: name }),
      page.getByText(name, { exact: true }),
    ];

    // Custom RPC networks live under the 13.x "Custom" tab; try the current
    // (default) tab first, then the Custom tab. Selecting the tab is a no-op
    // on 12.x.
    let selected = await clickFirstVisible(candidates(), SHORT_TIMEOUT_MS);
    if (!selected) {
      await clickFirstVisible([page.getByRole('tab', { name: /^Custom$/i })], SHORT_TIMEOUT_MS);
      selected = await clickFirstVisible(candidates(), DEFAULT_TIMEOUT_MS);
    }
    if (!selected) {
      throw new Error(
        `Unable to select MetaMask network "${name}". Add it first with addNetwork(), and check "Show test networks" if it is a testnet.`,
      );
    }

    await waitForMetaMaskReady(page);
    await closeMetaMaskOverlay(page);
  }

  async approveNewNetwork() {
    const page = await this.notificationPage();
    await this.confirmFooterAction(page);

    // MetaMask follows up with a "switch to this network" step.
    if (!page.isClosed()) {
      await waitForMetaMaskReady(page);
      await this.confirmFooterAction(page, SHORT_TIMEOUT_MS).catch(() => undefined);
    }
  }

  async rejectNewNetwork() {
    const page = await this.notificationPage();
    await this.rejectFooterAction(page);
  }

  async approveSwitchNetwork() {
    const page = await this.notificationPage();
    await this.confirmFooterAction(page);
  }

  async rejectSwitchNetwork() {
    const page = await this.notificationPage();
    await this.rejectFooterAction(page);
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

  async rejectTokenPermission() {
    const page = await this.notificationPage();
    await this.rejectFooterAction(page);
  }

  async approveAddToken() {
    const page = await this.notificationPage();
    await this.confirmFooterAction(page);
  }

  async addNewToken() {
    await this.approveAddToken();
  }

  async rejectAddToken() {
    const page = await this.notificationPage();
    await this.rejectFooterAction(page);
  }

  async importWalletFromPrivateKey(privateKey: string) {
    const normalized = normalizePrivateKey(privateKey);
    const page = await this.preparedHome();
    await this.openAccountPicker(page);

    // 12.x: action button → "Import account". 13.x: add wallet → import.
    let importOpened = false;
    if (
      await clickFirstVisible(
        [page.locator(testId('multichain-account-menu-popover-action-button'))],
        SHORT_TIMEOUT_MS,
      )
    ) {
      importOpened = Boolean(
        await clickFirstVisible(
          [page.locator(testId('multichain-account-menu-popover-add-imported-account'))],
          SHORT_TIMEOUT_MS,
        ),
      );
    }
    if (!importOpened) {
      // 13.x: the add-wallet button sits below the (possibly long) account
      // list, so scroll it into view first. The wallet-type item id is
      // "private-key".
      const addWallet = page.locator(testId('account-list-add-wallet-button')).first();
      await addWallet.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT_MS }).catch(() => undefined);
      if (await clickFirstVisible([addWallet], DEFAULT_TIMEOUT_MS)) {
        importOpened = Boolean(
          await clickFirstVisible(
            [
              page.locator(testId('choose-wallet-type-private-key')),
              page.locator(testId('wallet-type-private-key')),
              page.getByText(/^(Private key|Import account)$/i),
            ],
            DEFAULT_TIMEOUT_MS,
          ),
        );
      }
    }
    if (!importOpened) {
      throw new Error(
        'Unable to open the MetaMask import-account flow — update web3-tester for this MetaMask version.',
      );
    }

    const keyFilled = await fillFirstVisible([page.locator('#private-key-box')], normalized);
    if (!keyFilled) throw new Error('Unable to find the MetaMask private key input.');

    const confirmed = await clickFirstVisible(
      [page.locator(testId('import-account-confirm-button'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!confirmed) throw new Error('Unable to confirm the MetaMask private key import.');

    // Success closes the dialog (the keyring import can take a moment);
    // failure keeps it open with inline help text.
    const dialogClosed = await isHidden(
      page.locator('#private-key-box'),
      DEFAULT_TIMEOUT_MS,
    ).catch(() => false);
    if (!dialogClosed) {
      const helpText = (
        await page.locator('.mm-help-text').first().textContent({ timeout: SHORT_TIMEOUT_MS }).catch(() => null)
      )?.trim();
      throw new Error(`MetaMask rejected the private key import${helpText ? `: ${helpText}` : '.'}`);
    }

    // The imported account becomes active.
    this.expectedAddress = undefined;
    await closeMetaMaskOverlay(page);
  }

  async addNewAccount(name?: string) {
    const page = await this.preparedHome();
    await this.openAccountPicker(page);

    // 12.x path: action button → Add account → optional name → submit.
    if (
      await clickFirstVisible(
        [page.locator(testId('multichain-account-menu-popover-action-button'))],
        SHORT_TIMEOUT_MS,
      )
    ) {
      if (
        await clickFirstVisible(
          [page.locator(testId('multichain-account-menu-popover-add-account'))],
          SHORT_TIMEOUT_MS,
        )
      ) {
        if (name) {
          await fillFirstVisible(
            [page.locator('#account-name'), page.locator(testId('account-name-input'))],
            name,
            SHORT_TIMEOUT_MS,
          );
        }
        const submitted = await clickFirstVisible(
          [
            page.locator(testId('submit-add-account-with-name')),
            page.getByRole('button', { name: /^(Add account|Create)$/i }),
          ],
          DEFAULT_TIMEOUT_MS,
        );
        if (!submitted) throw new Error('Unable to submit the MetaMask add-account dialog.');
        this.expectedAddress = undefined;
        await closeMetaMaskOverlay(page);
        return;
      }
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    // 13.x multichain tree: a single add button on the first SRP wallet.
    const added = await clickFirstVisible(
      [page.locator(testId('add-multichain-account-button')).first()],
      DEFAULT_TIMEOUT_MS,
    );
    if (!added) {
      throw new Error(
        'Unable to find the MetaMask add-account control — update web3-tester for this MetaMask version.',
      );
    }
    await isHidden(page.getByText(/Adding account/i), DEFAULT_TIMEOUT_MS).catch(() => undefined);
    await waitForMetaMaskReady(page);
    this.expectedAddress = undefined;

    if (name) {
      // Rename the freshly created (last) account row while the picker is up.
      const row = accountRowLocator(page).last();
      await this.renameAccountRow(page, row, name);
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await closeMetaMaskOverlay(page);
  }

  async switchAccount(nameOrAddress: string) {
    const page = await this.preparedHome();
    await this.openAccountPicker(page);

    const row = accountRowLocator(page).filter({ hasText: accountRowMatcher(nameOrAddress) }).first();
    const clicked = await clickFirstVisible([row], DEFAULT_TIMEOUT_MS, { requireEnabled: false });
    if (!clicked) {
      throw new Error(
        `Unable to find MetaMask account "${nameOrAddress}" in the picker. On 13.x the rows show ` +
          'names, so address matching is best-effort — prefer account names.',
      );
    }

    await waitForMetaMaskReady(page);
    this.expectedAddress = FULL_ADDRESS_PATTERN.test(nameOrAddress) ? nameOrAddress : undefined;
    await closeMetaMaskOverlay(page);
  }

  async renameAccount(currentName: string, newName: string) {
    const page = await this.preparedHome();
    await this.openAccountPicker(page);

    const row = accountRowLocator(page).filter({ hasText: accountRowMatcher(currentName) }).first();
    if (!(await isVisible(row, DEFAULT_TIMEOUT_MS).catch(() => false))) {
      throw new Error(`Unable to find MetaMask account "${currentName}" to rename.`);
    }
    await this.renameAccountRow(page, row, newName, currentName);
    await page.keyboard.press('Escape').catch(() => undefined);
    await closeMetaMaskOverlay(page);
  }

  async lock() {
    const page = await this.preparedHome();
    await this.openGlobalMenu(page);

    const locked = await clickFirstVisible(
      [page.locator(testId('global-menu-lock')), page.getByText(/^Lock( MetaMask)?$/i)],
      DEFAULT_TIMEOUT_MS,
    );
    if (!locked) throw new Error('Unable to find the MetaMask lock action in the global menu.');

    const lockScreen = await findVisibleLocator(metaMaskUnlockPasswordLocators(page), DEFAULT_TIMEOUT_MS);
    if (!lockScreen) throw new Error('MetaMask did not show the unlock screen after locking.');
  }

  async unlock(password?: string) {
    const target = password ?? this.walletPassword;
    if (!target) {
      throw new Error('unlock() needs a password — pass one or provide setup.password at launch.');
    }

    const page = await openExtensionHome(this.context, this.extensionId);
    if (!(await isMetaMaskUnlockVisible(page))) return;
    await unlockMetaMask(page, target);
  }

  async resetAccount() {
    const page = await this.preparedHome();
    await this.openGlobalMenu(page);

    const settingsOpened = await clickFirstVisible(
      [page.locator(testId('global-menu-settings')), page.getByText(/^Settings$/i)],
      DEFAULT_TIMEOUT_MS,
    );
    if (!settingsOpened) throw new Error('Unable to open MetaMask settings.');
    await waitForMetaMaskReady(page);

    // 12.x: Advanced tab → "Clear activity tab data".
    if (
      await clickFirstVisible(
        [page.locator(testId('advanced-setting-reset-account')).getByRole('button')],
        SHORT_TIMEOUT_MS,
      )
    ) {
      await this.confirmResetModal(page);
      await this.leaveSettings(page);
      return;
    }
    if (
      await clickFirstVisible(
        [
          page.getByRole('tab', { name: /^Advanced$/i }),
          page.locator('.tab-bar__tab').filter({ hasText: /^Advanced$/ }),
        ],
        SHORT_TIMEOUT_MS,
      )
    ) {
      if (
        await clickFirstVisible(
          [
            page.locator(testId('advanced-setting-reset-account')).getByRole('button'),
            page.getByRole('button', { name: /Clear activity( tab)? data/i }),
          ],
          SHORT_TIMEOUT_MS,
        )
      ) {
        await this.confirmResetModal(page);
        await this.leaveSettings(page);
        return;
      }
    }

    // 13.x: Developer tools tab → "Delete activity and nonce data".
    if (
      await clickFirstVisible(
        [
          page.locator(testId('settings-tab-item-developer-tools')),
          page.getByText(/^Developer tools$/i),
        ],
        SHORT_TIMEOUT_MS,
      )
    ) {
      if (
        await clickFirstVisible(
          [
            page.locator(testId('developer-options-delete-activity-and-nonce-data')).getByRole('button'),
            page.locator(testId('developer-options-delete-activity-and-nonce-data')),
          ],
          SHORT_TIMEOUT_MS,
        )
      ) {
        await this.confirmResetModal(page);
        await this.leaveSettings(page);
        return;
      }
    }

    // Fallback: the settings search (the Developer tools tab can be
    // feature-flag hidden in production profiles).
    if (
      await clickFirstVisible([page.locator(testId('settings-header-search-button'))], SHORT_TIMEOUT_MS)
    ) {
      await fillFirstVisible(
        [page.locator(testId('settings-header-search-input')), page.locator('input[type="search"]')],
        'Clear activity',
        SHORT_TIMEOUT_MS,
      );
      if (
        await clickFirstVisible(
          [page.locator(testId('settings-search-result-item')).first()],
          SHORT_TIMEOUT_MS,
        )
      ) {
        const cleared = await clickFirstVisible(
          [
            page.locator(testId('advanced-setting-reset-account')).getByRole('button'),
            page.locator(testId('developer-options-delete-activity-and-nonce-data')).getByRole('button'),
            page.getByRole('button', { name: /Clear activity( tab)? data|Delete activity/i }),
          ],
          DEFAULT_TIMEOUT_MS,
        );
        if (cleared) {
          await this.confirmResetModal(page);
          await this.leaveSettings(page);
          return;
        }
      }
    }

    throw new Error(
      'Unable to find the MetaMask reset-account control (Clear activity / Delete activity and ' +
        'nonce data) — update web3-tester for this MetaMask version.',
    );
  }

  async toggleShowTestNetworks(on?: boolean) {
    const page = await this.preparedHome();

    const pickerOpened = await clickFirstVisible(metaMaskNetworkPickerLocators(page), DEFAULT_TIMEOUT_MS);
    if (!pickerOpened) throw new Error('Unable to open the MetaMask network picker.');
    await waitForMetaMaskReady(page);

    // The 13.x network manager splits into Popular/Custom tabs and renders
    // the test-networks section (and its toggle) under Custom. No-op on
    // 12.x. The modal animates in, so give the click room to stabilize.
    await wait(300);
    await clickFirstVisible(
      [page.getByRole('tab', { name: /^Custom$/i }), page.getByText('Custom', { exact: true })],
      8_000,
    );

    const toggle = await findVisibleLocator(
      [
        // 13.x carries a testid.
        page.locator(testId('networks-page-show-test-networks')),
        // 12.x renders text next to a ToggleButton with no testid.
        page
          .getByText(/Show test networks/i)
          .locator('xpath=following::label[contains(@class,"toggle-button")][1]'),
        page.locator('label.toggle-button').first(),
      ],
      DEFAULT_TIMEOUT_MS,
      { requireEnabled: false },
    );
    if (!toggle) {
      throw new Error(
        'Unable to find the MetaMask "Show test networks" toggle. MetaMask 13.x renders it only ' +
          'when a test-chain network is configured (e.g. addNetwork() with chainId 11155111) — ' +
          'fresh profiles ship none.',
      );
    }

    if (on === undefined) {
      await toggle.click();
    } else {
      const current = await this.readToggleState(toggle);
      if (current !== on) {
        await toggle.click();
      }
    }

    await waitForMetaMaskReady(page);
    await page.keyboard.press('Escape').catch(() => undefined);
    await closeMetaMaskOverlay(page);
  }

  async importToken(token: RealWalletToken) {
    if (!FULL_ADDRESS_PATTERN.test(token.address)) {
      throw new Error('importToken requires a 20-byte 0x token address.');
    }
    const page = await this.preparedHome();

    // The token list (and its control bar) lives on the Tokens tab.
    await clickFirstVisible(
      [
        page.locator(testId('account-overview__asset-tab')),
        page.getByRole('button', { name: /^Tokens$/i }),
      ],
      SHORT_TIMEOUT_MS,
    );

    const menuOpened = await clickFirstVisible(
      [page.locator(testId('asset-list-control-bar-action-button'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!menuOpened) throw new Error('Unable to open the MetaMask token list menu.');

    const importClicked = await clickFirstVisible(
      [page.locator(testId('importTokens')), page.getByText(/^Import tokens$/i)],
      DEFAULT_TIMEOUT_MS,
    );
    if (!importClicked) throw new Error('Unable to open the MetaMask Import tokens dialog.');

    await clickFirstVisible(
      [
        page.locator(testId('import-tokens-modal-custom-token-tab')),
        page.getByRole('tab', { name: /Custom token/i }),
        page.getByText('Custom token', { exact: true }),
      ],
      SHORT_TIMEOUT_MS,
    );

    if (token.networkName) {
      const dropdownOpened = await clickFirstVisible(
        [
          page.locator(testId('import-tokens-drop-down-custom-import')),
          page.locator(testId('test-import-tokens-drop-down-custom-import')),
        ],
        SHORT_TIMEOUT_MS,
      );
      if (dropdownOpened) {
        const picked = await clickFirstVisible(
          [page.getByText(token.networkName, { exact: true })],
          DEFAULT_TIMEOUT_MS,
        );
        if (!picked) {
          throw new Error(`Unable to select network "${token.networkName}" in the token import dialog.`);
        }
      }
    }

    const addressFilled = await fillFirstVisible(
      [page.locator(testId('import-tokens-modal-custom-address'))],
      token.address,
    );
    if (!addressFilled) throw new Error('Unable to fill the token contract address.');

    // Upstream re-render race: only fill symbol/decimals while Next is still
    // disabled (MetaMask clears the inputs when contract metadata loads).
    const nextButton = page.locator(testId('import-tokens-button-next')).first();
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
    while (Date.now() < deadline && !(await nextButton.isEnabled().catch(() => false))) {
      if (token.symbol) {
        await fillFirstVisible(
          [page.locator(testId('import-tokens-modal-custom-symbol'))],
          token.symbol,
          SHORT_TIMEOUT_MS,
        );
      }
      if (token.decimals !== undefined) {
        await fillFirstVisible(
          [page.locator(testId('import-tokens-modal-custom-decimals'))],
          String(token.decimals),
          SHORT_TIMEOUT_MS,
        );
      }
      await wait(250);
    }

    const next = await clickFirstVisible([nextButton], SHORT_TIMEOUT_MS);
    if (!next) {
      throw new Error(
        'MetaMask never enabled the Import Tokens "Next" button — check the token address, ' +
          'network, and (for contracts the RPC cannot read) pass symbol/decimals explicitly.',
      );
    }

    const imported = await clickFirstVisible(
      [
        page.locator(testId('import-tokens-modal-import-button')),
        page.getByRole('button', { name: /^Import( tokens)?$/i }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!imported) throw new Error('Unable to confirm the MetaMask token import.');

    await isHidden(page.locator(testId('import-tokens-modal-custom-address')), DEFAULT_TIMEOUT_MS).catch(
      () => undefined,
    );
    await closeMetaMaskOverlay(page);
  }

  async confirmTransactionAndWaitForMining(
    options: { gasSetting?: RealWalletGasSettings; timeoutMs?: number } = {},
  ): Promise<{ txHash?: `0x${string}` }> {
    await this.confirmTransaction({ gasSetting: options.gasSetting });

    const timeoutMs = options.timeoutMs ?? 60_000;
    const page = await this.preparedHome();

    const activityOpened = await clickFirstVisible(
      [
        page.locator(testId('account-overview__activity-tab')),
        page.getByRole('button', { name: /^Activity$/i }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!activityOpened) throw new Error('Unable to open the MetaMask activity tab.');

    const row = page
      .locator(
        '[data-testid="transaction-list-item"], [data-testid="activity-list-item"], .transaction-list-item, .activity-list-item',
      )
      .first();
    const statusVisible = (status: string) =>
      isVisible(page.locator(testId(`transaction-status-label--${status}`)).first(), LOCATOR_PROBE_MS).catch(
        () => false,
      );

    const deadline = Date.now() + timeoutMs;
    let confirmed = false;
    while (Date.now() < deadline) {
      if ((await statusVisible('failed')) || (await statusVisible('dropped'))) {
        throw new Error('The newest MetaMask activity entry failed or was dropped.');
      }
      if (await statusVisible('confirmed')) {
        confirmed = true;
        break;
      }
      // Instant-mining nodes may never render a pending state: a visible row
      // with no pending/queued label counts as confirmed.
      if (
        (await isVisible(row, LOCATOR_PROBE_MS).catch(() => false)) &&
        !(await statusVisible('pending')) &&
        !(await statusVisible('queued'))
      ) {
        confirmed = true;
        break;
      }
      await wait(LOCATOR_PROBE_MS);
    }
    if (!confirmed) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the transaction to confirm in the activity tab.`,
      );
    }

    // Best-effort hash read — never throws; the mining wait already passed.
    let txHash: `0x${string}` | undefined;
    try {
      if (await clickFirstVisible([row], SHORT_TIMEOUT_MS, { requireEnabled: false })) {
        await waitForMetaMaskReady(page);
        const copied = await clickFirstVisible(
          [
            page.getByRole('button', { name: /Copy transaction ID/i }),
            page.getByText(/Copy transaction ID/i),
          ],
          SHORT_TIMEOUT_MS,
          { requireEnabled: false },
        );
        if (copied) {
          const pasted = await this.readClipboardViaPaste();
          if (isFullTxHash(pasted)) txHash = pasted;
        }
        await closeMetaMaskOverlay(page);
        await page.keyboard.press('Escape').catch(() => undefined);
      }
    } catch {
      // txHash stays undefined.
    }

    return { txHash };
  }

  // ── shared private helpers for the account/settings surface ─────────────

  private async preparedHome(): Promise<Page> {
    const page = await this.home();
    await waitForMetaMaskHome(page);
    await closeMetaMaskOverlay(page);
    return page;
  }

  private async openAccountPicker(page: Page) {
    const opened = await clickFirstVisible(
      [page.locator(testId('account-menu-icon'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!opened) throw new Error('Unable to open the MetaMask account picker.');
    await waitForMetaMaskReady(page);
    // Let the (virtualized) account list settle before callers scroll for
    // the add-wallet button at its foot.
    await isVisible(accountRowLocator(page).first(), DEFAULT_TIMEOUT_MS).catch(() => undefined);
  }

  private async openGlobalMenu(page: Page) {
    const opened = await clickFirstVisible(
      [page.locator(testId('account-options-menu-button'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!opened) throw new Error('Unable to open the MetaMask global menu.');
  }

  private async renameAccountRow(page: Page, row: Locator, newName: string, label?: string) {
    // 13.x: cell accessory → "Rename" menu item.
    if (
      await clickFirstVisible(
        [row.locator(testId('multichain-account-cell-end-accessory'))],
        SHORT_TIMEOUT_MS,
      )
    ) {
      const renameClicked = await clickFirstVisible(
        [
          page.locator('.multichain-account-cell-menu-item[aria-label="Rename"]'),
          page.getByRole('menuitem', { name: /^Rename$/i }),
          page.getByText('Rename', { exact: true }),
        ],
        SHORT_TIMEOUT_MS,
      );
      if (renameClicked) {
        await this.fillAccountNameAndSave(page, newName);
        return;
      }
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    // 12.x: row options menu → Account details → editable label.
    const menuOpened = await clickFirstVisible(
      [
        row.locator(testId('account-list-item-menu-button')),
        ...(label ? [page.getByRole('button', { name: `${label} Options` })] : []),
      ],
      SHORT_TIMEOUT_MS,
    );
    if (!menuOpened) {
      throw new Error('Unable to open the MetaMask account row menu to rename.');
    }
    const detailsOpened = await clickFirstVisible(
      [page.locator(testId('account-list-menu-details'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!detailsOpened) throw new Error('Unable to open the MetaMask account details to rename.');

    const editOpened = await clickFirstVisible(
      [page.locator(testId('editable-label-button'))],
      DEFAULT_TIMEOUT_MS,
    );
    if (!editOpened) throw new Error('Unable to open the MetaMask account name editor.');

    await this.fillAccountNameAndSave(page, newName);
    await closeMetaMaskOverlay(page);
  }

  private async fillAccountNameAndSave(page: Page, newName: string) {
    const filled = await fillFirstVisible(
      [
        page.locator(`${testId('account-name-input')} input`),
        page.locator(testId('account-name-input')),
        page.locator(`${testId('editable-input')} input`),
        page.locator(testId('editable-input')),
      ],
      newName,
      DEFAULT_TIMEOUT_MS,
    );
    if (!filled) throw new Error('Unable to fill the MetaMask account name input.');

    const saved = await clickFirstVisible(
      [
        page.locator(testId('save-account-label-input')),
        page.locator('.mm-button-base[aria-label="Confirm"]'),
        page.getByRole('button', { name: /^(Confirm|Save)$/i }),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!saved) throw new Error('Unable to save the MetaMask account name.');
    await waitForMetaMaskReady(page);
  }

  private async confirmResetModal(page: Page) {
    // 12.x labels the confirm "Clear"; 13.x labels it "Delete".
    const confirmed = await clickFirstVisible(
      [
        page.locator(testId('delete-activity-and-nonce-data-button')),
        page.getByRole('button', { name: /^(Clear|Delete)$/i }),
        page.locator('.modal button.btn-danger-primary'),
      ],
      DEFAULT_TIMEOUT_MS,
    );
    if (!confirmed) throw new Error('Unable to confirm the MetaMask reset-account dialog.');
    await waitForMetaMaskReady(page);
  }

  private async leaveSettings(page: Page) {
    await clickFirstVisible(
      [page.locator(testId('settings-back-button')), page.locator('.settings-page__close-button')],
      SHORT_TIMEOUT_MS,
    );
    await page.goto(extensionUrl(this.extensionId)).catch(() => undefined);
    await waitForMetaMaskReady(page);
    await closeMetaMaskOverlay(page);
  }

  private async readToggleState(toggle: Locator): Promise<boolean | undefined> {
    const checkbox = toggle.locator('input[type="checkbox"]').first();
    const checked = await checkbox.isChecked({ timeout: LOCATOR_PROBE_MS }).catch(() => undefined);
    if (checked !== undefined) return checked;

    const ariaChecked = await toggle.getAttribute('aria-checked').catch(() => null);
    if (ariaChecked === 'true' || ariaChecked === 'false') return ariaChecked === 'true';

    const className = (await toggle.getAttribute('class').catch(() => null)) ?? '';
    if (/toggle-button--on/.test(className)) return true;
    if (/toggle-button--off/.test(className)) return false;
    return undefined;
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

  private async confirmFooterAction(page: Page, timeout = DEFAULT_TIMEOUT_MS): Promise<Locator> {
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
    return confirmed;
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

    // Newer MetaMask shows the currently selected account with an "Edit
    // accounts" affordance; expand it so the full list renders.
    await clickFirstVisible(
      [
        page.locator(testId('edit-accounts')),
        page.getByRole('button', { name: /Edit accounts?/i }),
      ],
      SHORT_TIMEOUT_MS,
    );

    const rowLocators = [
      page.locator('.choose-account-list .choose-account-list__account'),
      page.locator(testId('choose-account-list')).locator('[role="listitem"], li'),
      page.locator('.multichain-account-list-item'),
      page.locator('[data-testid="account-list-item"]'),
    ];

    let rows: Locator | undefined;
    for (const candidate of rowLocators) {
      if ((await candidate.count()) > 0) {
        rows = candidate;
        break;
      }
    }

    if (!rows) {
      throw new Error(
        `Unable to locate the MetaMask account list in the connect prompt to select: ${accounts.join(', ')}. ` +
          'Connect without the accounts argument to use the default account, or update web3-tester for this MetaMask version.',
      );
    }

    const rowCount = await rows.count();
    const expected = accounts.map((account) => account.toLowerCase());
    const expectedShort = accounts.map(shortAddress);
    let matched = false;

    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const text = ((await row.textContent()) ?? '').toLowerCase();
      const matches =
        expected.some((account) => text.includes(account)) ||
        expectedShort.some((account) => text.includes(account));
      if (!matches) continue;

      const checkbox = row.locator('input[type="checkbox"]').first();
      if (await isVisible(checkbox, SHORT_TIMEOUT_MS).catch(() => false)) await checkbox.check();
      else await row.click();
      matched = true;
      break;
    }

    if (!matched) {
      throw new Error(
        `Unable to find requested MetaMask account in connect prompt: ${accounts.join(', ')}.`,
      );
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
      // Playwright's headless mode uses the headless shell, which cannot load
      // extensions; new headless is enabled via the browser arg instead.
      ...(options.headless ? ['--headless=new'] : []),
    ],
    baseURL: options.baseURL,
    headless: false,
    // Text fallbacks in the selector stacks are English; pin the UI locale.
    locale: 'en-US',
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
    addNetwork: (network) => wallet.addNetwork(network),
    addNewAccount: (name) => wallet.addNewAccount(name),
    addNewToken: () => wallet.addNewToken(),
    approveAddToken: () => wallet.approveAddToken(),
    approveNewNetwork: () => wallet.approveNewNetwork(),
    approveSwitchNetwork: () => wallet.approveSwitchNetwork(),
    approveTokenPermission: (approvalOptions) => wallet.approveTokenPermission(approvalOptions),
    close: () => context.close(),
    confirmSignature: () => wallet.confirmSignature(),
    confirmTransaction: (confirmationOptions) => wallet.confirmTransaction(confirmationOptions),
    confirmTransactionAndWaitForMining: (miningOptions) =>
      wallet.confirmTransactionAndWaitForMining(miningOptions),
    connectToDapp: (accounts) => wallet.connectToDapp(accounts),
    context,
    extensionId,
    getAccountAddress: () => wallet.getAccountAddress(),
    importToken: (token) => wallet.importToken(token),
    importWalletFromPrivateKey: (privateKey) => wallet.importWalletFromPrivateKey(privateKey),
    lock: () => wallet.lock(),
    rejectAddToken: () => wallet.rejectAddToken(),
    rejectNewNetwork: () => wallet.rejectNewNetwork(),
    rejectSignature: () => wallet.rejectSignature(),
    rejectSwitchNetwork: () => wallet.rejectSwitchNetwork(),
    rejectTokenPermission: () => wallet.rejectTokenPermission(),
    rejectTransaction: () => wallet.rejectTransaction(),
    renameAccount: (currentName, newName) => wallet.renameAccount(currentName, newName),
    resetAccount: () => wallet.resetAccount(),
    switchAccount: (nameOrAddress) => wallet.switchAccount(nameOrAddress),
    switchNetwork: (name, switchOptions) => wallet.switchNetwork(name, switchOptions),
    toggleShowTestNetworks: (on) => wallet.toggleShowTestNetworks(on),
    unlock: (password) => wallet.unlock(password),
    wallet,
  };
}
