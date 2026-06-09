import { test as base } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { foundry } from 'viem/chains';
import { AnvilInstance, ChainController } from './anvil.js';
import { MockWalletController } from './mock-wallet-controller.js';
const workerPort = (workerIndex) => Number(process.env.ANVIL_PORT ?? 8545) + workerIndex;
const resolveAnvilExecutable = () => {
    if (process.env.ANVIL_EXECUTABLE) {
        return process.env.ANVIL_EXECUTABLE;
    }
    const localCandidates = [
        join(process.cwd(), 'tools', 'foundry', 'anvil.exe'),
        join(process.cwd(), 'tools', 'foundry', 'anvil'),
    ];
    return localCandidates.find((candidate) => existsSync(candidate));
};
export const test = base.extend({
    walletOptions: [
        async ({}, use) => {
            await use({});
        },
        { option: true },
    ],
    anvilOptions: [
        async ({}, use) => {
            await use({
                runtime: process.env.ANVIL_RUNTIME === 'docker' ? 'docker' : 'binary',
                executable: resolveAnvilExecutable(),
                dockerImage: process.env.ANVIL_DOCKER_IMAGE,
                host: process.env.ANVIL_HOST ?? '127.0.0.1',
                chainId: Number(process.env.ANVIL_CHAIN_ID ?? foundry.id),
                forkUrl: process.env.ANVIL_FORK_URL,
                silent: process.env.ANVIL_SILENT !== 'false',
            });
        },
        { scope: 'worker', option: true },
    ],
    anvil: [
        async ({ anvilOptions }, use, workerInfo) => {
            const anvil = await AnvilInstance.start({
                ...anvilOptions,
                port: anvilOptions.port ?? workerPort(workerInfo.workerIndex),
            });
            try {
                await use(anvil);
            }
            finally {
                await anvil.stop();
            }
        },
        { scope: 'worker' },
    ],
    chain: [
        async ({ anvil }, use) => {
            await use(new ChainController({
                rpcUrl: anvil.rpcUrl,
                chainId: anvil.chainId,
            }));
        },
        { scope: 'worker' },
    ],
    wallet: async ({ page, chain, walletOptions: customWalletOptions }, use) => {
        const snapshotId = await chain.snapshot();
        const [defaultAccount] = await chain.accounts();
        if (!defaultAccount) {
            throw new Error('Anvil did not expose any default accounts.');
        }
        const walletOptions = {
            accounts: [defaultAccount],
            chainId: chain.chainId,
            autoApprove: true,
            connected: true,
            ...customWalletOptions,
        };
        const wallet = new MockWalletController(page, chain, walletOptions);
        await wallet.injectMockProvider();
        try {
            await use(wallet);
        }
        finally {
            await chain.revert(snapshotId);
        }
    },
});
export { expect } from '@playwright/test';
//# sourceMappingURL=fixtures.js.map