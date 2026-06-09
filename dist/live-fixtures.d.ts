import { MockWalletController } from './mock-wallet-controller.js';
import { PrivateKeyRpcClient } from './private-key-rpc-client.js';
export type LiveWeb3Fixtures = {
    wallet: MockWalletController;
    liveClient: PrivateKeyRpcClient;
};
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & LiveWeb3Fixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>;
export { expect } from '@playwright/test';
//# sourceMappingURL=live-fixtures.d.ts.map