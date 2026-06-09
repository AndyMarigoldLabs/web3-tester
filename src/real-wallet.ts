import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

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

type MetaMaskController = RealWalletController & {
  importWallet(seedPhrase: string): Promise<void>;
  lockPage: {
    selectors: {
      passwordInput: string;
    };
  };
  onboardingPage: {
    selectors: {
      GetStartedPageSelectors: {
        importWallet: string;
      };
    };
  };
  page: Page;
};

type SynpressMetaMaskModule = {
  MetaMask: new (
    context: BrowserContext,
    page: Page,
    password: string,
    extensionId?: string,
  ) => MetaMaskController;
  getExtensionId(context: BrowserContext, extensionName: string): Promise<string>;
  unlockForFixture(page: Page, password: string): Promise<void>;
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

async function loadSynpressMetaMask(): Promise<SynpressMetaMaskModule> {
  return (await import('@synthetixio/synpress-metamask/playwright')) as unknown as SynpressMetaMaskModule;
}

async function isVisible(locator: { isVisible(): Promise<boolean> }) {
  return locator.isVisible().catch(() => false);
}

async function prepareMetaMask({
  expectedAddress,
  setup,
  unlockForFixture,
  wallet,
}: {
  expectedAddress?: string;
  setup?: RealWalletSetup;
  unlockForFixture: SynpressMetaMaskModule['unlockForFixture'];
  wallet: MetaMaskController;
}) {
  const page = wallet.page;
  const onboardingImport = page.locator(wallet.onboardingPage.selectors.GetStartedPageSelectors.importWallet);
  if (await isVisible(onboardingImport)) {
    if (!setup?.password || !setup.seedPhrase) {
      throw new Error(
        'MetaMask is on onboarding. Provide setup.password and setup.seedPhrase to import a wallet through web3-tester, or use a preconfigured persistent profile.',
      );
    }

    await wallet.importWallet(setup.seedPhrase);
  }

  const unlockPassword = page.locator(wallet.lockPage.selectors.passwordInput);
  if (await isVisible(unlockPassword)) {
    if (!setup?.password) {
      throw new Error(
        'MetaMask profile is locked. Provide setup.password to unlock through web3-tester, or unlock the persistent profile before running.',
      );
    }

    await unlockForFixture(page, setup.password);
  }

  const address = await wallet.getAccountAddress().catch(() => undefined);
  if (expectedAddress && address && address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`MetaMask account ${address} does not match expected address ${expectedAddress}.`);
  }
}

export async function launchRealWallet(options: RealWalletLaunchOptions): Promise<RealWalletSession> {
  const { MetaMask, getExtensionId, unlockForFixture } = await loadSynpressMetaMask();
  const extensionName = options.extensionName ?? 'MetaMask';
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
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`chrome-extension://${extensionId}/home.html`);

  const wallet = new MetaMask(context, page, options.setup?.password ?? '', extensionId);
  await prepareMetaMask({
    expectedAddress: options.expectedAddress,
    setup: options.setup,
    unlockForFixture,
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
