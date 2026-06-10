import { expect as baseExpect, mergeExpects } from '@playwright/test';
import { encodeFunctionData, parseEther, type Hex } from 'viem';
import { foundry } from 'viem/chains';
import { expect, test } from '../src/fixtures.js';
import { anyValue } from '../src/matchers.js';
import { PrivateKeyRpcClient } from '../src/private-key-rpc-client.js';
import {
  EVENT_EMITTER_ABI,
  EVENT_EMITTER_BYTECODE,
  REVERTER_ABI,
  REVERTER_BYTECODE,
} from './contracts/fixtures.js';

const RECIPIENT = '0x000000000000000000000000000000000000beef' as const;
const ANVIL_KEY_0 =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

const sendFromPage = (page: import('@playwright/test').Page, tx: Record<string, unknown>) =>
  page.evaluate(
    (transaction) =>
      window.ethereum.request({ method: 'eth_sendTransaction', params: [transaction] }) as Promise<string>,
    tx,
  );

test.describe('toEmitEvent', () => {
  test('matches named, positional, predicate, and counted args on a promise receiver', async ({
    page,
    chain,
    wallet,
  }) => {
    const emitter = await chain.deployContract({
      abi: EVENT_EMITTER_ABI as never,
      bytecode: EVENT_EMITTER_BYTECODE,
    });
    await page.setContent('<main>emit</main>');

    const pending = wallet.waitForNextTransaction();
    await sendFromPage(page, {
      to: emitter.address,
      data: encodeFunctionData({ abi: EVENT_EMITTER_ABI, functionName: 'ping', args: [7n, 'hi'] }),
    });

    await expect(pending).toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping', {
      args: { sender: wallet.primaryAccount, id: 7, note: 'hi' },
    });

    const hash = wallet.sentTransactions[0]!;
    await expect(hash).toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping', {
      args: [wallet.primaryAccount.toUpperCase().replace('0X', '0x') as Hex, undefined, 'hi'],
    });
    await expect(hash).toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping', {
      args: { id: (value: unknown) => value === 7n, note: anyValue },
      address: emitter.address,
    });
    await expect(hash).not.toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping', {
      args: { id: 999 },
    });

    // count semantics
    const twice = await sendFromPage(page, {
      to: emitter.address,
      data: encodeFunctionData({
        abi: EVENT_EMITTER_ABI,
        functionName: 'pingTwice',
        args: [1n, 'x'],
      }),
    });
    await expect(twice as Hex).toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping', { count: 2 });
    await expect(twice as Hex).not.toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping', {
      count: 1,
    });
  });

  test('failure message lists the actually-emitted events', async ({ page, chain, wallet }) => {
    const emitter = await chain.deployContract({
      abi: EVENT_EMITTER_ABI as never,
      bytecode: EVENT_EMITTER_BYTECODE,
    });
    await page.setContent('<main>emit</main>');
    const hash = (await sendFromPage(page, {
      to: emitter.address,
      data: encodeFunctionData({ abi: EVENT_EMITTER_ABI, functionName: 'ping', args: [7n, 'hi'] }),
    })) as Hex;
    expect(wallet.sentTransactions).toContain(hash);

    let thrown: Error | undefined;
    try {
      await expect(hash).toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping', {
        args: { id: 999 },
        timeout: 2_000,
      });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('found 0');
    expect(thrown?.message).toContain('Ping(');
  });

  test('a non-hash receiver fails with a clear message', async ({ chain }) => {
    let thrown: Error | undefined;
    try {
      await expect('0x1234' as Hex).toEmitEvent(chain, EVENT_EMITTER_ABI as never, 'Ping');
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('not a transaction hash');
  });
});

test.describe('balance matchers', () => {
  test('toChangeBalance excludes the sender fee by default (hardhat parity)', async ({
    page,
    chain,
    wallet,
  }) => {
    await page.setContent('<main>pay</main>');
    const hash = (await sendFromPage(page, {
      to: RECIPIENT,
      value: `0x${parseEther('1').toString(16)}`,
    })) as Hex;

    await expect(hash).toChangeBalance(chain, wallet.primaryAccount, -parseEther('1'));
    await expect(hash).toChangeBalance(chain, RECIPIENT, parseEther('1'));

    const receipt = await chain.client.getTransactionReceipt({ hash });
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    await expect(hash).toChangeBalance(chain, wallet.primaryAccount, -(parseEther('1') + fee), {
      includeFee: true,
    });

    await expect({ hash }).toChangeBalances(chain, [
      { address: wallet.primaryAccount, delta: -parseEther('1') },
      { address: RECIPIENT, delta: parseEther('1') },
    ]);
    await expect(hash).not.toChangeBalance(chain, RECIPIENT, parseEther('2'));
  });
});

test.describe('token matchers', () => {
  test('toChangeTokenBalance(s) and toHaveTokenBalance', async ({ chain }) => {
    const [deployer] = await chain.accounts();
    const token = await chain.deployErc20({ initialSupply: 1_000n, mintTo: deployer });

    const hash = await chain.client.writeContract({
      address: token.address,
      abi: token.abi,
      functionName: 'transfer',
      args: [RECIPIENT, 250n],
      account: deployer!,
      chain: chain.client.chain,
    });

    await expect(hash).toChangeTokenBalance(chain, token.address, RECIPIENT, 250n);
    await expect(hash).toChangeTokenBalances(chain, token.address, [
      { address: deployer!, delta: -250n },
      { address: RECIPIENT, delta: 250n },
    ]);

    await expect(RECIPIENT).toHaveTokenBalance(chain, token.address, 250n);
    await expect(RECIPIENT).toHaveTokenBalance(
      chain,
      token.address,
      (balance: bigint) => balance > 100n,
    );
    await expect(RECIPIENT).not.toHaveTokenBalance(chain, token.address, 9n);

    // ChainLike polymorphism: ChainController, bare viem client, { client }.
    await expect(RECIPIENT).toHaveTokenBalance(chain.client as never, token.address, 250n);
    await expect(RECIPIENT).toHaveTokenBalance({ client: chain.client } as never, token.address, 250n);

    // expect.poll re-reads each attempt — the eventual-consistency pattern.
    await expect.poll(() => RECIPIENT).toHaveTokenBalance(chain, token.address, 250n);
  });

  test('a 32-byte receiver is refused with an address-shape message', async ({ chain }) => {
    const fakeHash = `0x${'ab'.repeat(32)}` as Hex;
    let thrown: Error | undefined;
    try {
      await expect(fakeHash).toHaveTokenBalance(chain, RECIPIENT, 1n);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('not a 20-byte address');
  });
});

test.describe('revert matchers', () => {
  test('rejected promises (estimation failures) decode reasons, custom errors, and panics', async ({
    chain,
  }) => {
    const reverter = await chain.deployContract({
      abi: REVERTER_ABI as never,
      bytecode: REVERTER_BYTECODE,
    });
    const [account] = await chain.accounts();
    const write = (functionName: string, args: readonly unknown[] = []) =>
      chain.client.writeContract({
        address: reverter.address,
        abi: REVERTER_ABI as never,
        functionName,
        args,
        account: account!,
        chain: chain.client.chain,
      } as never);

    await expect(write('revertWithReason')).toBeReverted(chain);
    await expect(write('revertWithReason')).toBeRevertedWith(chain, 'boom');
    await expect(write('revertWithReason')).toBeRevertedWith(chain, /boo/);
    await expect(write('revertWithCustom', [150n])).toBeRevertedWithCustomError(
      chain,
      REVERTER_ABI as never,
      'CapExceeded',
      { args: [150n, 100n] },
    );
    await expect(write('panicWithAssert')).toBeRevertedWithPanic(chain, 0x01);
    await expect(write('panicWithAssert')).toBeRevertedWithPanic(chain);

    // Wrong reason fails with the actual decoded reason in the message.
    let thrown: Error | undefined;
    try {
      await expect(write('revertWithReason')).toBeRevertedWith(chain, 'not-boom');
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('boom');
  });

  test('mined reverted transactions recover the reason via parent-block replay', async ({
    chain,
  }) => {
    const reverter = await chain.deployContract({
      abi: REVERTER_ABI as never,
      bytecode: REVERTER_BYTECODE,
    });
    const [account] = await chain.accounts();

    // Explicit gas skips estimation, so anvil MINES the revert (status 0x0).
    const hash = (await chain.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: account,
          to: reverter.address,
          data: encodeFunctionData({ abi: REVERTER_ABI, functionName: 'revertWithReason' }),
          gas: '0x30000',
        },
      ],
    })) as Hex;

    await expect(hash).toBeReverted(chain);
    await expect(hash).toBeRevertedWith(chain, 'boom');

    const decoded = await chain.waitForTransaction(hash, { abi: REVERTER_ABI as never });
    expect(decoded.status).toBe('reverted');
    expect(decoded.revertReason).toBe('boom');
  });

  test('successful transactions fail the revert matchers (and pass .not)', async ({ chain }) => {
    const reverter = await chain.deployContract({
      abi: REVERTER_ABI as never,
      bytecode: REVERTER_BYTECODE,
    });
    const [account] = await chain.accounts();
    const hash = await chain.client.writeContract({
      address: reverter.address,
      abi: REVERTER_ABI as never,
      functionName: 'succeed',
      account: account!,
      chain: chain.client.chain,
    } as never);

    await expect(hash).not.toBeReverted(chain);

    let thrown: Error | undefined;
    try {
      await expect(hash).toBeReverted(chain);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('succeeded');
  });

  test('wallet approval failures are never mistaken for reverts', async ({ chain }) => {
    const rejection = Promise.reject(new Error('User rejected the request.'));
    rejection.catch(() => undefined);

    let thrown: Error | undefined;
    try {
      await expect(rejection).toBeReverted(chain);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('wallet approval failure');
  });
});

test.describe('live mode and composition', () => {
  test('PrivateKeyRpcClient satisfies ChainLike via .client', async ({ anvil, chain }) => {
    const live = new PrivateKeyRpcClient({
      privateKey: ANVIL_KEY_0,
      chain: { ...foundry, id: anvil.chainId },
      rpcUrl: anvil.rpcUrl,
    });

    const [deployer] = await chain.accounts();
    const token = await chain.deployErc20({ initialSupply: 42n, mintTo: deployer });
    await expect(deployer!).toHaveTokenBalance(live, token.address, 42n);
  });

  test('mergeExpects and matcher-spread both compose', async ({ chain }) => {
    const custom = baseExpect.extend({
      toBeSeven(received: number) {
        return { pass: received === 7, message: () => `${received} is not seven` };
      },
    });
    const merged = mergeExpects(expect, custom);

    merged(7).toBeSeven();
    const [deployer] = await chain.accounts();
    const token = await chain.deployErc20({ initialSupply: 1n, mintTo: deployer });
    await merged(deployer!).toHaveTokenBalance(chain, token.address, 1n);
  });
});
