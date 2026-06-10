import { AnvilInstance, ChainController, type AnvilOptions } from './anvil.js';
import { MockWalletController, type MockWalletControllerOptions } from './mock-wallet-controller.js';
export type Web3Fixtures = {
    wallet: MockWalletController;
    walletOptions: MockWalletFixtureOptions;
};
export type Web3WorkerFixtures = {
    anvil: AnvilInstance;
    chain: ChainController;
    anvilOptions: AnvilOptions;
};
export type MockWalletFixtureOptions = Omit<Partial<MockWalletControllerOptions>, 'accounts' | 'chainId'>;
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & Web3Fixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions & Web3WorkerFixtures>;
export { expect } from '@playwright/test';
//# sourceMappingURL=fixtures.d.ts.map