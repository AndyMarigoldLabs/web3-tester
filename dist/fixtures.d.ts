import { AnvilInstance, ChainController, type AnvilOptions } from './anvil.js';
import { MockWalletController, type MockWalletControllerOptions } from './mock-wallet-controller.js';
export type Web3Fixtures = {
    wallet: MockWalletController;
    walletOptions: MockWalletFixtureOptions;
};
/**
 * Spec for one extra per-worker Anvil chain. Port and host are
 * fixture-managed; everything else defaults to the worker's anvilOptions
 * (so docker runtime / custom executables apply to extras too).
 */
export type AnvilChainSpec = Omit<AnvilOptions, 'port' | 'host' | 'allowNonLoopbackHost'> & {
    chainId: number;
};
export type Web3WorkerFixtures = {
    anvil: AnvilInstance;
    chain: ChainController;
    anvilOptions: AnvilOptions;
    /** Worker option, default []. One extra AnvilInstance is started per entry. */
    extraChains: readonly AnvilChainSpec[];
    /** Worker-scoped: extra chainId -> running AnvilInstance. */
    extraAnvils: ReadonlyMap<number, AnvilInstance>;
    /** Worker-scoped: chainId -> ChainController, INCLUDING the primary chain. */
    chains: ReadonlyMap<number, ChainController>;
};
export type MockWalletFixtureOptions = Omit<Partial<MockWalletControllerOptions>, 'accounts' | 'chainId'>;
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & Web3Fixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions & Web3WorkerFixtures>;
export { expect } from '@playwright/test';
//# sourceMappingURL=fixtures.d.ts.map