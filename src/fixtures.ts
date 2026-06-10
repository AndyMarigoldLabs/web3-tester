import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Address } from 'viem';
import { foundry } from 'viem/chains';
import { AnvilInstance, ChainController, type AnvilOptions, type AnvilSnapshotId } from './anvil.js';
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

// chainId stays fixture-managed (the chain/chains fixtures own routing).
export type MockWalletFixtureOptions = Omit<Partial<MockWalletControllerOptions>, 'chainId'> & {
  /** Indexes into chain.accounts(); mutually exclusive with `accounts`. */
  accountIndexes?: readonly number[];
};

const resolveAccounts = async (
  chain: ChainController,
  options: { accounts?: readonly Address[]; accountIndexes?: readonly number[] },
  fallbackIndex: number,
): Promise<Address[]> => {
  if (options.accounts && options.accountIndexes) {
    throw new Error('Pass either accounts or accountIndexes, not both.');
  }

  if (options.accounts) {
    return [...options.accounts];
  }

  const available = await chain.accounts();
  const pick = (index: number): Address => {
    const account = available[index];
    if (!account) {
      throw new Error(
        `Account index ${index} is out of range: the node exposes ${available.length} accounts. ` +
          'Raise anvilOptions: { accounts: n } to generate more.',
      );
    }
    return account;
  };

  if (options.accountIndexes) {
    return options.accountIndexes.map(pick);
  }

  return [pick(fallbackIndex)];
};

// Base defaults to 8645 rather than anvil's own 8545 so the fixture never
// collides with a developer-run dev node on the conventional port.
//
// Port bands (ANVIL_PORT shifts everything wholesale):
//   primary anvil:  base + workerIndex                       (8645, 8646, …)
//   extraChains:    base + 1000 + workerIndex*20 + index     (9645+, 20/worker)
// Spec-managed anvils use their own bands with distinct mod-20 sub-offsets:
//   tests/anvil.spec.ts                  19100 + w*20 + {0..3}
//   tests/private-key-rpc-client.spec.ts 19510 + w*20 + {0..2}  (≡ 10..12)
//   tests/mock-wallet-multichain.spec.ts 19700 + w*20 + {13..19}
//   tests/erc20.spec.ts                  19900 + w*20 + {4..5}
// The extras band assumes workerIndex < 1000.
const workerPort = (workerIndex: number): number =>
  Number(process.env.ANVIL_PORT ?? 8645) + workerIndex;

const extraChainPort = (workerIndex: number, index: number): number =>
  Number(process.env.ANVIL_PORT ?? 8645) + 1000 + workerIndex * 20 + index;

const resolveAnvilExecutable = (): string | undefined => {
  if (process.env.ANVIL_EXECUTABLE) {
    return process.env.ANVIL_EXECUTABLE;
  }

  const localCandidates = [
    join(process.cwd(), 'tools', 'foundry', 'anvil.exe'),
    join(process.cwd(), 'tools', 'foundry', 'anvil'),
  ];

  return localCandidates.find((candidate) => existsSync(candidate));
};

export const test = base.extend<Web3Fixtures, Web3WorkerFixtures>({
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
        allowNonLoopbackHost: process.env.ANVIL_ALLOW_NON_LOOPBACK === 'true',
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
      } finally {
        await anvil.stop();
      }
    },
    { scope: 'worker' },
  ],

  chain: [
    async ({ anvil }, use) => {
      await use(
        new ChainController({
          rpcUrl: anvil.rpcUrl,
          chainId: anvil.chainId,
        }),
      );
    },
    { scope: 'worker' },
  ],

  extraChains: [
    async ({}, use) => {
      await use([]);
    },
    { scope: 'worker', option: true },
  ],

  extraAnvils: [
    async ({ anvil, anvilOptions, extraChains }, use, workerInfo) => {
      const instances = new Map<number, AnvilInstance>();

      try {
        const seenChainIds = new Set<number>([anvil.chainId]);
        for (const [index, spec] of extraChains.entries()) {
          if (seenChainIds.has(spec.chainId)) {
            throw new Error(
              `extraChains lists chain id ${spec.chainId} more than once (or it collides with the primary chain).`,
            );
          }
          seenChainIds.add(spec.chainId);

          // Extras inherit the worker anvilOptions (runtime, executable,
          // docker image, host…) under the spec's own overrides; the port is
          // fixture-managed in a dedicated band.
          instances.set(
            spec.chainId,
            await AnvilInstance.start({
              ...anvilOptions,
              ...spec,
              port: extraChainPort(workerInfo.workerIndex, index),
            }),
          );
        }

        await use(instances);
      } finally {
        await Promise.all([...instances.values()].map((instance) => instance.stop()));
      }
    },
    { scope: 'worker' },
  ],

  chains: [
    async ({ anvil, chain, extraAnvils }, use) => {
      const map = new Map<number, ChainController>();
      map.set(anvil.chainId, chain);
      for (const [chainId, instance] of extraAnvils) {
        map.set(chainId, new ChainController({ rpcUrl: instance.rpcUrl, chainId }));
      }
      await use(map);
    },
    { scope: 'worker' },
  ],

  // The single per-test snapshot/revert owner. Playwright memoizes fixtures,
  // so a test using both wallet and createUser takes exactly ONE snapshot
  // per chain, and teardown runs dependents first — user contexts close
  // before the single revert.
  _chainIsolation: async ({ chains }, use) => {
    const snapshots = new Map<ChainController, AnvilSnapshotId>();
    for (const controller of chains.values()) {
      snapshots.set(controller, await controller.snapshot());
    }

    try {
      await use(undefined as void);
    } finally {
      for (const [controller, snapshotId] of snapshots) {
        await controller.revert(snapshotId);
      }
    }
  },

  wallet: async ({ page, chain, chains, walletOptions: customWalletOptions, _chainIsolation }, use) => {
    void _chainIsolation;
    const { accounts, accountIndexes, ...controllerOverrides } = customWalletOptions;
    const resolvedAccounts = await resolveAccounts(chain, { accounts, accountIndexes }, 0);

    const wallet = new MockWalletController(
      page,
      chain,
      buildControllerOptions(chain, chains, resolvedAccounts, controllerOverrides),
    );
    await wallet.injectMockProvider();
    await use(wallet);
  },

  createUser: async (
    { browser, chain, chains, baseURL, walletOptions: customWalletOptions, _chainIsolation },
    use,
  ) => {
    void _chainIsolation;
    const sessions: UserSession[] = [];
    // Index 0 is the primary wallet fixture's default; users without
    // explicit accounts take 1, 2, 3… in creation order.
    let nextDefaultIndex = 1;

    const factory: CreateUser = async (options = {}) => {
      // The test's walletOptions are the base layer (so deny-mode or origin
      // scoping applies to every user) under per-call overrides — except
      // accounts/accountIndexes, which resolveAccounts owns per user.
      const {
        accounts: _baseAccounts,
        accountIndexes: _baseIndexes,
        ...baseOptions
      } = customWalletOptions;
      const merged = { ...baseOptions, ...options };
      const { accounts, accountIndexes, contextOptions, ...controllerOverrides } = merged;

      const resolvedAccounts = await resolveAccounts(
        chain,
        { accounts, accountIndexes },
        nextDefaultIndex,
      );
      if (!accounts && !accountIndexes) {
        nextDefaultIndex += 1;
      }

      const context = await browser.newContext({ baseURL, ...contextOptions });
      const page = await context.newPage();
      const wallet = new MockWalletController(
        page,
        chain,
        buildControllerOptions(chain, chains, resolvedAccounts, controllerOverrides),
      );
      await wallet.injectMockProvider();

      let closed = false;
      const session: UserSession = {
        context,
        page,
        wallet,
        close: async () => {
          if (closed) {
            return;
          }
          closed = true;
          await context.close().catch(() => undefined);
        },
      };
      sessions.push(session);
      return session;
    };

    try {
      await use(factory);
    } finally {
      for (const session of sessions) {
        await session.close();
      }
    }
  },
});

// The primary chain is the positional rpcClient; extras go in the chains
// option. User-supplied chains entries win per key, but fixture extras are
// never silently dropped (their Anvils keep running).
const buildControllerOptions = (
  chain: ChainController,
  chains: ReadonlyMap<number, ChainController>,
  accounts: readonly Address[],
  overrides: Omit<MockWalletFixtureOptions, 'accounts' | 'accountIndexes'>,
): MockWalletControllerOptions => {
  const extraBackends = Object.fromEntries(
    [...chains].filter(([chainId]) => chainId !== chain.chainId),
  );
  const mergedChains = { ...extraBackends, ...overrides.chains };

  return {
    accounts,
    chainId: chain.chainId,
    autoApprove: true,
    connected: true,
    ...overrides,
    ...(Object.keys(mergedChains).length > 0 ? { chains: mergedChains } : {}),
  };
};

// The web3-extended expect: every matcher from ./matchers.js, zero migration.
export { expect } from './matchers.js';
