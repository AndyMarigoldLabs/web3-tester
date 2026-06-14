import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

export type RealWalletProfile = {
  profileDirectory?: string;
  userDataDir: string;
};

export type BrowserExtensionManifest = {
  manifest_version?: number;
  name?: string;
  version?: string;
  action?: { default_popup?: string };
  browser_action?: { default_popup?: string };
  options_ui?: { page?: string };
  side_panel?: { default_path?: string };
  [key: string]: unknown;
};

export type RealWalletExtensionLaunchOptions = {
  baseURL?: string;
  /**
   * Exact Chrome extension display name used when runtime/service-worker
   * discovery is inconclusive. For localized manifests (`__MSG_*__`), pass
   * this explicitly or pass `extensionId`.
   */
  extensionName?: string;
  /**
   * Known extension ID. Useful for persistent profiles that already have a
   * wallet installed or for extensions without a service worker.
   */
  extensionId?: string;
  /** Path to an unpacked Chrome extension directory. */
  extensionPath: string;
  /**
   * Run the browser headless. There is deliberately no default — choose
   * explicitly here or via WEB3_TESTER_REAL_WALLET_HEADLESS=true|false.
   */
  headless?: boolean;
  /**
   * Extension page to open after launch. Defaults to the manifest action
   * popup/options/side-panel page when present; pass false to leave all
   * extension pages untouched.
   */
  initialPage?: string | false;
  /** Additional Chromium launch args appended after extension args. */
  launchArgs?: readonly string[];
  locale?: string;
  profileDir: string;
  slowMo?: number;
};

export type RealWalletExtensionSession = {
  close(): Promise<void>;
  context: BrowserContext;
  extensionId: string;
  extensionPath: string;
  manifest: BrowserExtensionManifest;
  /** Page opened from `initialPage`, when configured/resolved. */
  page?: Page;
  profile: RealWalletProfile;
  extensionUrl(page?: string): string;
  openPage(page?: string): Promise<Page>;
};

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

/**
 * Resolves the headed/headless choice for real-wallet extension launches.
 * The explicit option wins over the environment.
 */
export function resolveRealWalletHeadless(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;

  const env = process.env.WEB3_TESTER_REAL_WALLET_HEADLESS;
  if (env === 'true') return true;
  if (env === 'false') return false;
  if (env) {
    throw new Error(`WEB3_TESTER_REAL_WALLET_HEADLESS must be "true" or "false", got "${env}".`);
  }

  throw new Error(
    'Real-wallet launches need an explicit headed/headless choice: pass headless: true|false ' +
      '(launchRealWalletExtension / launchRealWallet / buildWalletProfile / realWalletOptions) or set ' +
      'WEB3_TESTER_REAL_WALLET_HEADLESS=true|false. Headed is the fully validated mode; ' +
      'headless needs the full Chromium build (npx playwright install chromium).',
  );
}

export function readExtensionManifest(extensionPath: string): BrowserExtensionManifest {
  const manifestPath = path.join(extensionPath, 'manifest.json');
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read extension manifest at ${manifestPath}: ${message}`);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('manifest is not an object');
    }
    return parsed as BrowserExtensionManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse extension manifest at ${manifestPath}: ${message}`);
  }
}

function usableManifestString(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^__MSG_[^_]+__$/.test(trimmed)) return undefined;
  return trimmed;
}

export function extensionManifestName(extensionPath: string): string | undefined {
  return usableManifestString(readExtensionManifest(extensionPath).name);
}

export function extensionManifestDefaultPage(
  manifest: BrowserExtensionManifest,
): string | undefined {
  return (
    usableManifestString(manifest.action?.default_popup) ??
    usableManifestString(manifest.browser_action?.default_popup) ??
    usableManifestString(manifest.options_ui?.page) ??
    usableManifestString(manifest.side_panel?.default_path)
  );
}

function normalizeExtensionPage(page = '') {
  return page.replace(/^\/+/, '');
}

export function extensionPageUrl(extensionId: string, page = '') {
  const normalized = normalizeExtensionPage(page);
  return `chrome-extension://${extensionId}/${normalized}`;
}

export function resolveExtensionPageUrl(extensionId: string, page = '') {
  if (/^chrome-extension:\/\//.test(page)) return page;
  return extensionPageUrl(extensionId, page);
}

export function extensionIdFromUrl(url: string) {
  return /^chrome-extension:\/\/([^/]+)\//.exec(url)?.[1];
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecoverableExtensionPageOpenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ERR_BLOCKED_BY_CLIENT|page crashed|target page, context or browser has been closed/i.test(message);
}

async function discoverExtensionIdFromRuntime(
  context: BrowserContext,
  timeoutMs: number,
) {
  const workerId = context.serviceWorkers().map((worker) => extensionIdFromUrl(worker.url())).find(Boolean);
  if (workerId) return workerId;

  const pageId = context.pages().map((page) => extensionIdFromUrl(page.url())).find(Boolean);
  if (pageId) return pageId;

  const worker = await context.waitForEvent('serviceworker', { timeout: timeoutMs }).catch(() => undefined);
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

export async function discoverRealWalletExtensionId(
  context: BrowserContext,
  options: { extensionName?: string; timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const runtimeId = await discoverExtensionIdFromRuntime(context, timeoutMs);
  if (runtimeId) return runtimeId;

  if (!options.extensionName) {
    throw new Error(
      'Unable to discover extension ID from runtime pages/service workers. Pass extensionName or extensionId.',
    );
  }

  return discoverExtensionIdFromManagementApi(context, options.extensionName);
}

export async function openRealWalletExtensionPage(
  context: BrowserContext,
  extensionId: string,
  page = '',
) {
  const url = resolveExtensionPageUrl(extensionId, page);
  const acceptsHashRoute = !url.includes('#');
  let lastError: unknown;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = context
      .pages()
      .find((candidate) => {
        if (candidate.isClosed()) return false;
        const candidateUrl = candidate.url();
        return candidateUrl === url || (acceptsHashRoute && candidateUrl.startsWith(`${url}#`));
      });
    const target = existing ?? (await context.newPage());

    try {
      if (target.url() !== url) await target.goto(url, { waitUntil: 'domcontentloaded' });
      await target.waitForLoadState('domcontentloaded').catch(() => undefined);
      return target;
    } catch (error) {
      lastError = error;
      if (attempt === 5 || !isRecoverableExtensionPageOpenError(error)) throw error;
      await target.close().catch(() => undefined);
      await wait(750 + attempt * 750);
    }
  }

  throw lastError;
}

export async function launchRealWalletExtension(
  options: RealWalletExtensionLaunchOptions,
): Promise<RealWalletExtensionSession> {
  const extensionPath = path.resolve(options.extensionPath);
  if (!fs.existsSync(extensionPath)) {
    throw new Error(`Wallet extension path does not exist: ${extensionPath}`);
  }

  const manifest = readExtensionManifest(extensionPath);
  const extensionName = options.extensionName ?? usableManifestString(manifest.name);
  const headless = resolveRealWalletHeadless(options.headless);
  const profile = resolveRealWalletProfile(options.profileDir);
  const context = await chromium
    .launchPersistentContext(profile.userDataDir, {
      args: [
        ...(profile.profileDirectory ? [`--profile-directory=${profile.profileDirectory}`] : []),
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...(options.launchArgs ?? []),
      ],
      baseURL: options.baseURL,
      channel: 'chromium',
      headless,
      locale: options.locale ?? 'en-US',
      slowMo: options.slowMo,
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/executable doesn't exist/i.test(message)) {
        throw new Error(
          "Real-wallet extension mode needs the full Chromium build for channel 'chromium' — a " +
            'chromium_headless_shell-only install cannot load extensions. ' +
            'Run: npx playwright install chromium\n' +
            message,
        );
      }
      throw error;
    });

  let extensionId: string;
  let page: Page | undefined;
  try {
    extensionId =
      options.extensionId ??
      (await discoverRealWalletExtensionId(context, {
        extensionName,
      }));

    const initialPage =
      options.initialPage === undefined ? extensionManifestDefaultPage(manifest) : options.initialPage;
    page =
      initialPage === false || initialPage === undefined
        ? undefined
        : await openRealWalletExtensionPage(context, extensionId, initialPage);
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }

  return {
    close: () => context.close(),
    context,
    extensionId,
    extensionPath,
    manifest,
    page,
    profile,
    extensionUrl: (targetPage = '') => extensionPageUrl(extensionId, targetPage),
    openPage: (targetPage = '') => openRealWalletExtensionPage(context, extensionId, targetPage),
  };
}
