import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeAbiParameters, keccak256, parseUnits } from 'viem';
import { AnvilInstance, ChainController } from '../src/anvil.js';
import {
  dealErc20,
  Erc20DealError,
  TEST_ERC20_SOURCE_SHA256,
  type Erc20SlotInfo,
} from '../src/erc20.js';
import type { JsonRpcRequest } from '../src/types.js';
import {
  SHARES_TOKEN_ABI,
  SHARES_TOKEN_BYTECODE,
  VYPER_LAYOUT_TOKEN_ABI,
  VYPER_LAYOUT_TOKEN_BYTECODE,
} from './contracts/fixtures.js';

// Band 19900 + w*20 with sub-offsets 4..5 — distinct mod-20 from anvil.spec
// (0..3), private-key-rpc-client (10..12), and mock-wallet-multichain (13..19).
const basePort = (workerIndex: number) => 19900 + workerIndex * 20;

const USER = '0x1111111111111111111111111111111111111111' as const;
const OTHER = '0x2222222222222222222222222222222222222222' as const;

// Counts RPC traffic so cache behavior is pinned without exposing internals.
const countingClient = (chain: ChainController) => {
  const calls: string[] = [];
  return {
    calls,
    request: (request: JsonRpcRequest) => {
      calls.push(request.method);
      return chain.request(request);
    },
  };
};

let anvil: AnvilInstance;
let chain: ChainController;

test.beforeAll(async ({}, testInfo) => {
  anvil = await AnvilInstance.start({
    port: basePort(testInfo.workerIndex) + 4,
    chainId: 31337,
    silent: true,
  });
  chain = new ChainController({ rpcUrl: anvil.rpcUrl, chainId: anvil.chainId });
});

test.afterAll(async () => {
  await anvil?.stop();
});

test('deployErc20: defaults and custom parameters', async () => {
  const defaulted = await chain.deployErc20();
  expect(defaulted.name).toBe('Test Token');
  expect(defaulted.symbol).toBe('TEST');
  expect(defaulted.decimals).toBe(18);
  expect(await chain.getErc20Balance(defaulted.address, USER)).toBe(0n);

  const custom = await chain.deployErc20({
    name: 'QA Dollar',
    symbol: 'USDX',
    decimals: 6,
    initialSupply: parseUnits('1000', 6),
    mintTo: USER,
  });
  expect(
    await chain.client.readContract({
      address: custom.address,
      abi: custom.abi,
      functionName: 'symbol',
    }),
  ).toBe('USDX');
  expect(await chain.getErc20Balance(custom.address, USER)).toBe(parseUnits('1000', 6));
  expect(
    await chain.client.readContract({
      address: custom.address,
      abi: custom.abi,
      functionName: 'totalSupply',
    }),
  ).toBe(parseUnits('1000', 6));
});

test('deployContract surfaces a reverting constructor', async () => {
  // PUSH1 0 PUSH1 0 REVERT — the constructor always reverts.
  await expect(
    chain.deployContract({ abi: [], bytecode: '0x60006000fd' }),
  ).rejects.toThrow(/deployment reverted/);
});

test('dealErc20 sets the exact balance and leaves everything else untouched', async () => {
  const token = await chain.deployErc20({ initialSupply: parseUnits('50', 18), mintTo: OTHER });

  await chain.dealErc20(token.address, USER, parseUnits('123', 18));

  expect(await chain.getErc20Balance(token.address, USER)).toBe(parseUnits('123', 18));
  // Discovery used state overrides, so no other holder or supply moved.
  expect(await chain.getErc20Balance(token.address, OTHER)).toBe(parseUnits('50', 18));
  expect(
    await chain.client.readContract({
      address: token.address,
      abi: token.abi,
      functionName: 'totalSupply',
    }),
  ).toBe(parseUnits('50', 18));
});

test('the slot cache makes the second deal cheap (one write, no discovery)', async () => {
  const token = await chain.deployErc20();
  const counting = countingClient(chain);
  const cache = new Map<string, Erc20SlotInfo>();

  await dealErc20(counting, token.address, USER, 7n, {}, cache);
  const discoveryWrites = counting.calls.filter((m) => m === 'anvil_setStorageAt').length;
  expect(discoveryWrites).toBe(1); // discovery is override-based: only the final write

  counting.calls.length = 0;
  await dealErc20(counting, token.address, USER, 9n, {}, cache);
  expect(counting.calls.filter((m) => m === 'anvil_setStorageAt')).toHaveLength(1);
  // No discovery probing on the cache hit: just the verify call.
  expect(counting.calls.filter((m) => m === 'eth_call').length).toBeLessThanOrEqual(1);
});

test('a poisoned cache entry is evicted, rediscovered, and the stray write restored', async () => {
  const token = await chain.deployErc20();
  const cache = new Map<string, Erc20SlotInfo>();
  // Wrong layout AND wrong base slot.
  cache.set(token.address.toLowerCase(), { layout: 'vyper', balanceSlot: 42n });

  await dealErc20(chain, token.address, USER, 1_000n, {}, cache);
  expect(await chain.getErc20Balance(token.address, USER)).toBe(1_000n);
  expect(cache.get(token.address.toLowerCase())).toMatchObject({
    layout: 'solidity',
    balanceSlot: 0n,
  });
});

test('adjustTotalSupply shifts supply by the delta, both directions, and underflows loudly', async () => {
  const token = await chain.deployErc20({ initialSupply: 1_000n, mintTo: OTHER });
  const supply = () =>
    chain.client.readContract({ address: token.address, abi: token.abi, functionName: 'totalSupply' });

  await chain.dealErc20(token.address, USER, 600n, { adjustTotalSupply: true });
  expect(await supply()).toBe(1_600n);

  await chain.dealErc20(token.address, USER, 100n, { adjustTotalSupply: true });
  expect(await supply()).toBe(1_100n);

  // Make the delta more negative than the whole supply: deal a huge balance
  // WITHOUT adjusting, then deal it away WITH adjusting.
  await chain.dealErc20(token.address, USER, 10_000n);
  await expect(
    chain.dealErc20(token.address, USER, 0n, { adjustTotalSupply: true }),
  ).rejects.toThrow(/underflow/);
});

test('Vyper-layout balances are discovered through the reversed hash order', async () => {
  const deployed = await chain.deployContract({
    abi: VYPER_LAYOUT_TOKEN_ABI as never,
    bytecode: VYPER_LAYOUT_TOKEN_BYTECODE,
  });

  await chain.dealErc20(deployed.address, USER, 555n);
  expect(await chain.getErc20Balance(deployed.address, USER)).toBe(555n);
});

test('computed balanceOf (shares tokens) fails with Erc20DealError and leaves storage clean', async () => {
  const deployed = await chain.deployContract({
    abi: SHARES_TOKEN_ABI as never,
    bytecode: SHARES_TOKEN_BYTECODE,
  });
  const shares = () =>
    chain.client.readContract({
      address: deployed.address,
      abi: SHARES_TOKEN_ABI as never,
      functionName: 'sharesOf',
      args: [USER],
    } as never);

  await chain.client.writeContract({
    address: deployed.address,
    abi: SHARES_TOKEN_ABI as never,
    functionName: 'mintShares',
    args: [USER, 5n],
    account: (await chain.accounts())[0]!,
    chain: chain.client.chain,
  } as never);

  const error = await chain.dealErc20(deployed.address, USER, 100n).catch((e) => e);
  expect(error).toBeInstanceOf(Erc20DealError);
  expect(String(error.message)).toContain('balance slot');

  // Probing was override-only: the shares are untouched.
  expect(await shares()).toBe(5n);
  expect(await chain.getErc20Balance(deployed.address, USER)).toBe(10n);
});

test('an explicit { slot } skips discovery entirely', async () => {
  const token = await chain.deployErc20();
  const counting = countingClient(chain);

  await dealErc20(counting, token.address, USER, 42n, { slot: 0 });
  // One verify call and one write — no probe traffic.
  expect(counting.calls.filter((m) => m === 'eth_call').length).toBeLessThanOrEqual(1);
  expect(counting.calls.filter((m) => m === 'anvil_setStorageAt')).toHaveLength(1);
  expect(await chain.getErc20Balance(token.address, USER)).toBe(42n);

  // A different amount, or the pre-existing balance would "verify" the
  // wrong slot by coincidence.
  await expect(
    dealErc20(chain, token.address, USER, 43n, { slot: 7, layout: 'vyper' }),
  ).rejects.toThrow(/explicit slot/);
});

test('amount validation happens before any RPC', async () => {
  const counting = countingClient(chain);
  await expect(dealErc20(counting, USER, USER, -1n)).rejects.toThrow(RangeError);
  await expect(dealErc20(counting, USER, USER, 2n ** 256n)).rejects.toThrow(RangeError);
  expect(counting.calls).toHaveLength(0);
});

test('a non-ERC20 address fails fast', async () => {
  await expect(chain.dealErc20(USER, OTHER, 1n)).rejects.toThrow(/not an ERC-20/);
});

test('dealing works on a fork, leaving the upstream chain untouched', async ({}, testInfo) => {
  // Hermetic stand-in for ANVIL_FORK_URL mainnet forking: fork our own anvil.
  const token = await chain.deployErc20({ initialSupply: 1_000n, mintTo: OTHER });

  const fork = await AnvilInstance.start({
    port: basePort(testInfo.workerIndex) + 5,
    chainId: 31337,
    forkUrl: anvil.rpcUrl,
    silent: true,
  });
  const forkChain = new ChainController({ rpcUrl: fork.rpcUrl, chainId: fork.chainId });

  try {
    // Discovery reads fall through to upstream; the write overlays locally.
    await forkChain.dealErc20(token.address, USER, 777n);
    expect(await forkChain.getErc20Balance(token.address, USER)).toBe(777n);
    expect(await forkChain.getErc20Balance(token.address, OTHER)).toBe(1_000n);

    // Upstream never saw the deal.
    expect(await chain.getErc20Balance(token.address, USER)).toBe(0n);
  } finally {
    await fork.stop();
  }
});

test('setStorageAt / setCode / setNonce passthroughs work', async () => {
  const target = '0x3333333333333333333333333333333333333333' as const;

  await chain.setCode(target, '0x60016000526001601ff3'); // returns one byte 0x01
  expect(await chain.client.getCode({ address: target })).toBe('0x60016000526001601ff3');

  await chain.setNonce(target, 7);
  expect(await chain.client.getTransactionCount({ address: target })).toBe(7);

  const token = await chain.deployErc20();
  // Hand-computed slot write through the passthrough: solidity slot 0 mapping.
  const slot = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [USER, 0n]),
  );
  await chain.setStorageAt(token.address, BigInt(slot), 99n);
  expect(await chain.getErc20Balance(token.address, USER)).toBe(99n);
});

test('committed artifact provenance matches the contract source', async () => {
  const source = readFileSync(join(process.cwd(), 'contracts', 'TestERC20.sol'));
  const hash = createHash('sha256').update(source).digest('hex');
  expect(hash).toBe(TEST_ERC20_SOURCE_SHA256);
});
