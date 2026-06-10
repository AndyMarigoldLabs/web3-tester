import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { AnvilInstance, ChainController, type AnvilOptions } from './anvil.js';
import { MockWalletController, type MockWalletControllerOptions } from './mock-wallet-controller.js';
/** A second (third, …) user: its own browser context, page, and wallet. */
export type UserSession = {
    context: BrowserContext;
    page: Page;
    wallet: MockWalletController;
    /** Idempotent mid-test disposal ("user leaves"); also runs at teardown. */
    close(): Promise<void>;
};
export type CreateUserOptions = MockWalletFixtureOptions & {
    /**
     * Passed to browser.newContext(); baseURL is forwarded by default. Other
     * test.use context options (viewport, locale, storageState…) are NOT
     * inherited — pass them here when a user needs them.
     */
    contextOptions?: Parameters<Browser['newContext']>[0];
};
export type CreateUser = (options?: CreateUserOptions) => Promise<UserSession>;
export type Web3Fixtures = {
    wallet: MockWalletController;
    walletOptions: MockWalletFixtureOptions;
    /** Factory: fresh context + page + wallet on the shared worker chain(s). */
    createUser: CreateUser;
    /**
     * Internal plumbing: the single per-test snapshot/revert owner spanning
     * every running chain; wallet and createUser both depend on it.
     */
    _chainIsolation: void;
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
export type MockWalletFixtureOptions = Omit<Partial<MockWalletControllerOptions>, 'chainId'> & {
    /** Indexes into chain.accounts(); mutually exclusive with `accounts`. */
    accountIndexes?: readonly number[];
};
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & Web3Fixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions & Web3WorkerFixtures>;
export { expect } from '@playwright/test';
//# sourceMappingURL=fixtures.d.ts.map