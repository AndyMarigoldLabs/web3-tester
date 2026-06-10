import path from 'node:path';
import { test as base } from '@playwright/test';
import { prepareMetaMaskExtension } from './metamask-extension.js';
import { buildWalletProfile, cloneWalletProfile } from './real-wallet-cache.js';
import { launchRealWallet, } from './real-wallet.js';
const setupFromEnv = () => ({
    password: process.env.WEB3_TESTER_REAL_WALLET_PASSWORD || undefined,
    seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE || undefined,
});
/**
 * Playwright fixtures for real-MetaMask tests. Each test gets a disposable
 * clone of a cached, pre-onboarded profile (built once per seed phrase +
 * extension version), so tests are isolated, parallel-safe, and skip
 * onboarding cost after the first run. `context` and `page` are rebound to
 * the persistent extension context.
 */
export const test = base.extend({
    realWalletOptions: [
        async ({}, use) => {
            await use({});
        },
        { option: true },
    ],
    realWallet: async ({ realWalletOptions }, use, testInfo) => {
        const options = realWalletOptions;
        const setup = options.setup ?? setupFromEnv();
        const extensionPath = options.extensionPath ??
            process.env.WEB3_TESTER_REAL_WALLET_EXTENSION_PATH ??
            (await prepareMetaMaskExtension({ version: options.metamaskVersion }));
        let profileDir = options.profileDir ?? process.env.WEB3_TESTER_REAL_WALLET_PROFILE_DIR;
        if (!profileDir) {
            if (!setup.seedPhrase) {
                throw new Error('Real-wallet fixtures need a seed phrase (realWalletOptions.setup.seedPhrase or ' +
                    'WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE) to build a cached profile, ' +
                    'or an explicit profileDir pointing at a prepared MetaMask profile.');
            }
            const cachedProfile = await buildWalletProfile({
                extensionPath,
                setup,
                headless: options.headless,
            });
            profileDir = await cloneWalletProfile(cachedProfile, path.join(testInfo.outputDir, 'metamask-profile'));
        }
        const session = await launchRealWallet({
            baseURL: options.baseURL,
            expectedAddress: options.expectedAddress,
            extensionPath,
            headless: options.headless,
            profileDir,
            setup,
        });
        try {
            await use(session);
        }
        finally {
            await session.close().catch(() => undefined);
        }
    },
    context: async ({ realWallet }, use) => {
        await use(realWallet.context);
    },
    page: async ({ context }, use) => {
        const page = await context.newPage();
        await use(page);
        await page.close().catch(() => undefined);
    },
});
export { expect } from '@playwright/test';
//# sourceMappingURL=real-wallet-fixtures.js.map