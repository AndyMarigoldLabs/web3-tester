import { test as base } from '@playwright/test';
import { sepolia } from 'viem/chains';
import { MockWalletController, } from './mock-wallet-controller.js';
import { PrivateKeyRpcClient } from './private-key-rpc-client.js';
const resolveEnv = (names) => {
    for (const name of names) {
        if (name && process.env[name]) {
            return process.env[name];
        }
    }
    return undefined;
};
/**
 * Builds a live-chain fixture family. The defaults read the signing key from
 * WEB3_TESTER_PRIVATE_KEY (with the legacy FJORD_PRIVATE_KEY still honored)
 * and target Sepolia; pass options to bind other chains or env var names.
 */
export function createLiveFixtures(defaults = {}) {
    return base.extend({
        liveOptions: [
            async ({}, use) => {
                await use(defaults);
            },
            { option: true },
        ],
        liveClient: async ({ liveOptions }, use) => {
            const options = { ...defaults, ...liveOptions };
            const privateKeyEnv = options.privateKeyEnv ?? 'WEB3_TESTER_PRIVATE_KEY';
            const privateKey = resolveEnv([privateKeyEnv, 'FJORD_PRIVATE_KEY']);
            if (!privateKey) {
                throw new Error(`${privateKeyEnv} is required for live-chain tests.`);
            }
            const rpcUrlEnv = options.rpcUrlEnv ?? 'WEB3_TESTER_RPC_URL';
            await use(new PrivateKeyRpcClient({
                privateKey: privateKey,
                chain: options.chain ?? sepolia,
                rpcUrl: resolveEnv([rpcUrlEnv, 'SEPOLIA_RPC_URL']),
                allowMainnet: options.allowMainnet,
            }));
        },
        wallet: async ({ page, liveClient, liveOptions, baseURL }, use) => {
            const options = { ...defaults, ...liveOptions };
            const wallet = new MockWalletController(page, liveClient, {
                accounts: [liveClient.account.address],
                chainId: liveClient.chain.id,
                // A real key sits behind this provider, so nothing signs or connects
                // until the test arms it (wallet.approveNext(...) for one request,
                // wallet.autoApprove(true) or walletOptions for a whole test), and
                // only frames on the dapp's own origin can reach the wallet at all.
                autoApprove: false,
                connected: true,
                ...(baseURL ? { allowedOrigins: [baseURL] } : {}),
                // Masquerade as MetaMask by default so production wallet selectors
                // (wagmi / EIP-6963) detect the injected provider unmodified.
                providerInfo: { name: 'MetaMask', rdns: 'io.metamask' },
                ...options.walletOptions,
            });
            await wallet.injectMockProvider();
            await use(wallet);
        },
    });
}
export const test = createLiveFixtures();
export { expect } from '@playwright/test';
//# sourceMappingURL=live-fixtures.js.map