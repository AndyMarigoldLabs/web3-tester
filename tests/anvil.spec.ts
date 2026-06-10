import { expect, test } from '@playwright/test';
import { parseEther } from 'viem';
import { AnvilInstance, ChainController } from '../src/anvil.js';

// Each worker gets its own port band so specs stay parallel-safe.
const basePort = (workerIndex: number) => 19100 + workerIndex * 20;

test.describe('AnvilInstance lifecycle', () => {
  test('starts, reports the requested chain id, and stops', async ({}, testInfo) => {
    const port = basePort(testInfo.workerIndex);
    const anvil = await AnvilInstance.start({ port, chainId: 31337, silent: true });

    try {
      const response = await fetch(anvil.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] }),
      });
      const body = (await response.json()) as { result: string };
      expect(Number(BigInt(body.result))).toBe(31337);
    } finally {
      await anvil.stop();
    }

    // After stop, the endpoint must be gone.
    await expect(
      fetch(anvil.rpcUrl, { method: 'POST', body: '{}' }),
    ).rejects.toThrow();
  });

  test('fails loudly instead of adopting a pre-existing node on the same port (regression)', async ({}, testInfo) => {
    const port = basePort(testInfo.workerIndex) + 1;
    const occupant = await AnvilInstance.start({ port, chainId: 31337, silent: true });

    try {
      // Before the readiness fix this returned "ready" against the occupant —
      // even with a different chain id — in ~30ms.
      await expect(
        AnvilInstance.start({ port, chainId: 31399, silent: true, timeoutMs: 10_000 }),
      ).rejects.toThrow(/exited before it became ready|already running on port|reports chain id/i);

      // The occupant must be untouched.
      const response = await fetch(occupant.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] }),
      });
      const body = (await response.json()) as { result: string };
      expect(Number(BigInt(body.result))).toBe(31337);
    } finally {
      await occupant.stop();
    }
  });

  test('surfaces a clear error when the executable is missing', async ({}, testInfo) => {
    await expect(
      AnvilInstance.start({
        executable: '/nonexistent/anvil-binary',
        port: basePort(testInfo.workerIndex) + 2,
        silent: true,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/Failed to start Anvil executable/);
  });
});

test.describe('host binding guard', () => {
  // A nonexistent executable distinguishes the outcomes without ever binding
  // a socket: the guard error fires before spawn, the executable error after.
  // So even a guard regression cannot leak a node bound to 0.0.0.0.
  const NO_BINARY = {
    executable: '/nonexistent/anvil-binary',
    silent: true,
    timeoutMs: 5_000,
  } as const;

  test('refuses a non-loopback host without explicit opt-in', async () => {
    await expect(AnvilInstance.start({ ...NO_BINARY, host: '0.0.0.0' })).rejects.toThrow(
      /not a loopback interface/,
    );
  });

  test('refuses --host smuggled through extraArgs', async () => {
    await expect(
      AnvilInstance.start({ ...NO_BINARY, extraArgs: ['--host', '0.0.0.0'] }),
    ).rejects.toThrow(/not extraArgs --host/);
    await expect(
      AnvilInstance.start({ ...NO_BINARY, extraArgs: ['--host=0.0.0.0'] }),
    ).rejects.toThrow(/not extraArgs --host/);
  });

  test('allowNonLoopbackHost opts in past the guard', async () => {
    await expect(
      AnvilInstance.start({ ...NO_BINARY, host: '0.0.0.0', allowNonLoopbackHost: true }),
    ).rejects.toThrow(/Failed to start Anvil executable/);
  });

  test('loopback spellings pass the guard', async () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1']) {
      await expect(AnvilInstance.start({ ...NO_BINARY, host })).rejects.toThrow(
        /Failed to start Anvil executable/,
      );
    }
  });
});

test.describe('ChainController helpers', () => {
  let anvil: AnvilInstance;
  let chain: ChainController;

  test.beforeAll(async ({}, testInfo) => {
    anvil = await AnvilInstance.start({
      port: basePort(testInfo.workerIndex) + 3,
      chainId: 31337,
      silent: true,
    });
    chain = new ChainController({ rpcUrl: anvil.rpcUrl, chainId: anvil.chainId });
  });

  test.afterAll(async () => {
    await anvil?.stop();
  });

  test('setBalance and accounts', async () => {
    const [account] = await chain.accounts();
    expect(account).toMatch(/^0x/);

    await chain.setBalance(account, parseEther('123'));
    expect(await chain.client.getBalance({ address: account })).toBe(parseEther('123'));
  });

  test('snapshot and revert round-trip', async () => {
    const [account] = await chain.accounts();
    const before = await chain.client.getBalance({ address: account });

    const snapshot = await chain.snapshot();
    await chain.setBalance(account, before + 1n);
    expect(await chain.client.getBalance({ address: account })).toBe(before + 1n);

    await chain.revert(snapshot);
    expect(await chain.client.getBalance({ address: account })).toBe(before);
  });

  test('fastForward advances block timestamp', async () => {
    const before = await chain.client.getBlock();
    await chain.fastForward(3600);
    const after = await chain.client.getBlock();

    expect(Number(after.timestamp - before.timestamp)).toBeGreaterThanOrEqual(3600);
  });

  test('mine produces blocks', async () => {
    // cacheTime: 0 — viem caches getBlockNumber for 4s by default.
    const before = await chain.client.getBlockNumber({ cacheTime: 0 });
    await chain.mine(3);
    expect(await chain.client.getBlockNumber({ cacheTime: 0 })).toBe(before + 3n);
  });

  test('impersonateAccount allows sending from an arbitrary address', async () => {
    const whale = '0x00000000000000000000000000000000000a11ce' as const;
    const [recipient] = await chain.accounts();

    await chain.setBalance(whale, parseEther('10'));
    await chain.impersonateAccount(whale);
    try {
      const hash = (await chain.request({
        method: 'eth_sendTransaction',
        params: [{ from: whale, to: recipient, value: `0x${parseEther('1').toString(16)}` }],
      })) as `0x${string}`;
      expect(hash).toMatch(/^0x/);
      await chain.mine(1);

      const receipt = await chain.client.getTransactionReceipt({ hash });
      expect(receipt.from.toLowerCase()).toBe(whale);
    } finally {
      await chain.stopImpersonatingAccount(whale);
    }
  });
});
