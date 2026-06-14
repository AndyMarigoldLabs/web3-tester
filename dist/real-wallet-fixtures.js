import path from 'node:path';
import { test as base } from '@playwright/test';
import { prepareMetaMaskExtension } from './metamask-extension.js';
import { buildWalletProfile, cloneWalletProfile, } from './real-wallet-cache.js';
import { benchmarkForTest, benchmarkObjectMethods } from './benchmark.js';
import { launchRealWallet, } from './real-wallet.js';
const setupFromEnv = () => ({
    password: process.env.WEB3_TESTER_REAL_WALLET_PASSWORD || undefined,
    seedPhrase: process.env.WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE || undefined,
});
const assertChromiumProject = (browserName) => {
    if (browserName !== 'chromium') {
        throw new Error('@marigoldlabs/web3-tester/real-wallet-fixtures launch a Chromium extension context. ' +
            `The current Playwright project uses "${browserName}". Exclude real-wallet tests from non-Chromium ` +
            'projects, or run them in a dedicated Chromium project.');
    }
};
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
    realWallet: async ({ realWalletOptions, browserName }, use, testInfo) => {
        assertChromiumProject(browserName);
        const benchmark = benchmarkForTest(testInfo, { suite: 'real-wallet' });
        let session;
        try {
            const options = realWalletOptions;
            const setup = options.setup ?? setupFromEnv();
            const extensionPath = options.extensionPath ??
                process.env.WEB3_TESTER_REAL_WALLET_EXTENSION_PATH ??
                (await benchmark.measure('realWallet.prepareMetaMaskExtension', () => prepareMetaMaskExtension({ version: options.metamaskVersion })));
            let profileDir = options.profileDir ?? process.env.WEB3_TESTER_REAL_WALLET_PROFILE_DIR;
            if (!profileDir) {
                if (!setup.seedPhrase) {
                    throw new Error('Real-wallet fixtures need a seed phrase (realWalletOptions.setup.seedPhrase or ' +
                        'WEB3_TESTER_REAL_WALLET_SECRET_RECOVERY_PHRASE) to build a cached profile, ' +
                        'or an explicit profileDir pointing at a prepared MetaMask profile.');
                }
                const cachedProfile = await benchmark.measure('realWallet.buildWalletProfile', () => buildWalletProfile({
                    extensionPath,
                    setup,
                    headless: options.headless,
                    generation: options.generation,
                    customize: options.profileSetup,
                }));
                profileDir = await benchmark.measure('realWallet.cloneWalletProfile', () => cloneWalletProfile(cachedProfile, path.join(testInfo.outputDir, 'metamask-profile')));
            }
            session = await benchmark.measure('realWallet.launchRealWallet', () => launchRealWallet({
                baseURL: options.baseURL,
                expectedAddress: options.expectedAddress,
                extensionPath,
                generation: options.generation,
                headless: options.headless,
                profileDir,
                setup,
            }));
            await use(benchmarkObjectMethods(session, benchmark, { prefix: 'realWallet', exclude: ['close'] }));
        }
        finally {
            if (session) {
                const activeSession = session;
                await benchmark.measure('realWallet.close', () => activeSession.close().catch(() => undefined));
            }
            await benchmark.flush();
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
// The web3-extended expect: every matcher from ./matchers.js, zero migration.
export { expect } from './matchers.js';
//# sourceMappingURL=real-wallet-fixtures.js.map