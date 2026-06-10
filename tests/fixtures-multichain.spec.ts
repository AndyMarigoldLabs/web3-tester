import { parseEther } from 'viem';
import { expect, test } from '../src/fixtures.js';

// Worker option: the worker boots one extra Anvil on chain 84532 in the
// dedicated extras port band. Serial so both tests share that worker and the
// isolation assertion observes the revert, not a fresh node.
test.use({ extraChains: [{ chainId: 84532 }] });
test.describe.configure({ mode: 'serial' });

const requestFromPage = (page: import('@playwright/test').Page, method: string, params?: unknown) =>
  page.evaluate(
    async ({ method, params }) => {
      try {
        const result = await window.ethereum.request({ method, params });
        return { ok: true as const, result };
      } catch (error) {
        const err = error as { code?: number; message?: string };
        return { ok: false as const, error: { code: err.code ?? 0, message: err.message ?? '' } };
      }
    },
    { method, params },
  );

test('chains maps every running controller and the wallet routes to extras', async ({
  page,
  wallet,
  chain,
  chains,
}) => {
  expect([...chains.keys()].sort((a, b) => a - b)).toEqual([31337, 84532]);
  expect(chains.get(chain.chainId)).toBe(chain);

  const base = chains.get(84532)!;
  await base.setBalance(wallet.primaryAccount, parseEther('7'));

  await page.setContent('<main>multichain fixtures</main>');
  const switched = await requestFromPage(page, 'wallet_switchEthereumChain', [
    { chainId: '0x14a34' },
  ]);
  expect(switched.ok).toBe(true);

  const balance = await requestFromPage(page, 'eth_getBalance', [
    wallet.primaryAccount,
    'latest',
  ]);
  expect(BigInt(balance.ok ? (balance.result as string) : '0')).toBe(parseEther('7'));

  // The extra chain shares the default mnemonic, so the primary account can
  // transact there too.
  const sent = await requestFromPage(page, 'eth_sendTransaction', [
    { to: '0x000000000000000000000000000000000000beef', value: '0x1' },
  ]);
  expect(sent.ok).toBe(true);
  expect(wallet.sentTransactionRequests.at(-1)?.chainId).toBe('0x14a34');
});

test('extra-chain state reverts between tests', async ({ wallet, chains }) => {
  const base = chains.get(84532)!;
  // Default anvil funding, not the 7 ETH the previous test set.
  expect(await base.client.getBalance({ address: wallet.primaryAccount })).toBe(
    parseEther('10000'),
  );
});

test.describe('walletOptions.chains merges with fixture extras', () => {
  // A user-supplied chains map must not clobber the fixture-built extras
  // (their Anvils keep running); user entries add or win per key.
  test.use({ walletOptions: { chains: { 999: 'http://127.0.0.1:9' } } });

  test('fixture extras survive a user-supplied chains map', async ({ page, wallet }) => {
    expect(wallet.backedChainIds).toEqual(
      expect.arrayContaining(['0x7a69', '0x14a34', '0x3e7']),
    );

    await page.setContent('<main>merge</main>');
    const switched = await requestFromPage(page, 'wallet_switchEthereumChain', [
      { chainId: '0x14a34' },
    ]);
    expect(switched.ok).toBe(true);
    expect((await requestFromPage(page, 'eth_blockNumber')).ok).toBe(true);
  });
});
