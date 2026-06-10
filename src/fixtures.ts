import { test as base } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { foundry } from 'viem/chains';
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

export type MockWalletFixtureOptions = Omit<
  Partial<MockWalletControllerOptions>,
  'accounts' | 'chainId'
>;

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

  wallet: async ({ page, chain, chains, walletOptions: customWalletOptions }, use) => {
    // Per-test isolation must cover every chain a test can touch.
    const snapshots = new Map<ChainController, Awaited<ReturnType<ChainController['snapshot']>>>();
    for (const controller of chains.values()) {
      snapshots.set(controller, await controller.snapshot());
    }

    const [defaultAccount] = await chain.accounts();
    if (!defaultAccount) {
      throw new Error('Anvil did not expose any default accounts.');
    }

    // The primary chain is the positional rpcClient; extras go in the chains
    // option. User-supplied walletOptions.chains entries win per key, but
    // fixture extras are never silently dropped (their Anvils keep running).
    const extraBackends = Object.fromEntries(
      [...chains].filter(([chainId]) => chainId !== chain.chainId),
    );
    const mergedChains = { ...extraBackends, ...customWalletOptions.chains };

    const walletOptions: MockWalletControllerOptions = {
      accounts: [defaultAccount],
      chainId: chain.chainId,
      autoApprove: true,
      connected: true,
      ...customWalletOptions,
      ...(Object.keys(mergedChains).length > 0 ? { chains: mergedChains } : {}),
    };

    const wallet = new MockWalletController(page, chain, walletOptions);
    await wallet.injectMockProvider();

    try {
      await use(wallet);
    } finally {
      for (const [controller, snapshotId] of snapshots) {
        await controller.revert(snapshotId);
      }
    }
  },
});

export { expect } from '@playwright/test';
