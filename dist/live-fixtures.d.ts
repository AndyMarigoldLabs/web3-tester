import type { Chain } from 'viem';
import { MockWalletController, type MockWalletControllerOptions } from './mock-wallet-controller.js';
import { PrivateKeyRpcClient } from './private-key-rpc-client.js';
export type LiveFixtureOptions = {
    /** Target chain. Defaults to Sepolia. */
    chain?: Chain;
    /**
     * Passed through to PrivateKeyRpcClient for chains that are neither
     * `testnet: true` nor local dev chains. Without it such chains throw at
     * fixture setup.
     */
    allowMainnet?: boolean;
    /** Env var holding the signing key. Defaults to WEB3_TESTER_PRIVATE_KEY. */
    privateKeyEnv?: string;
    /** Env var holding the RPC URL. Defaults to WEB3_TESTER_RPC_URL. */
    rpcUrlEnv?: string;
    /**
     * Per-test overrides for the injected wallet (provider identity,
     * autoApprove, allowedOrigins, …). Live wallets default to
     * autoApprove: false and origin-scope the provider to baseURL; override
     * here only for keys you are comfortable auto-signing with.
     */
    walletOptions?: Omit<Partial<MockWalletControllerOptions>, 'accounts' | 'chainId'>;
};
export type LiveWeb3Fixtures = {
    liveOptions: LiveFixtureOptions;
    liveClient: PrivateKeyRpcClient;
    wallet: MockWalletController;
};
/**
 * Builds a live-chain fixture family. The defaults read the signing key from
 * WEB3_TESTER_PRIVATE_KEY (with the legacy FJORD_PRIVATE_KEY still honored)
 * and target Sepolia; pass options to bind other chains or env var names.
 */
export declare function createLiveFixtures(defaults?: LiveFixtureOptions): import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & LiveWeb3Fixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & LiveWeb3Fixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
export { expect } from './matchers.js';
//# sourceMappingURL=live-fixtures.d.ts.map