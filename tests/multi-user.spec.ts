import { parseEther } from 'viem';
import { expect, test } from '../src/fixtures.js';
import { MockWalletController } from '../src/mock-wallet-controller.js';

const SENTINEL = '0x00000000000000000000000000000000000c0ffe' as const;

const sendFromPage = (
  page: import('@playwright/test').Page,
  transaction: Record<string, unknown>,
) =>
  page.evaluate(
    async (tx) => {
      try {
        const result = await window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
        return { ok: true as const, result: result as string };
      } catch (error) {
        const err = error as { code?: number; message?: string };
        return { ok: false as const, code: err.code, message: err.message };
      }
    },
    transaction,
  );

test('two users transact on the shared chain from their own contexts', async ({
  page,
  wallet,
  chain,
  createUser,
}) => {
  const buyer = await createUser();

  // Distinct identities: account 0 vs account 1, in separate contexts.
  const accounts = await chain.accounts();
  expect(wallet.primaryAccount).toBe(accounts[0]);
  expect(buyer.wallet.primaryAccount).toBe(accounts[1]);

  await page.setContent('<main>seller</main>');
  await buyer.page.setContent('<main>buyer</main>');
  expect(await page.evaluate(() => window.ethereum.selectedAddress)).toBe(accounts[0]);
  expect(await buyer.page.evaluate(() => window.ethereum.selectedAddress)).toBe(accounts[1]);

  // Seller pays the buyer; the buyer sees it immediately on the shared chain.
  const before = await chain.client.getBalance({ address: buyer.wallet.primaryAccount });
  const sent = await sendFromPage(page, {
    to: buyer.wallet.primaryAccount,
    value: `0x${parseEther('2').toString(16)}`,
  });
  expect(sent.ok).toBe(true);
  expect(await chain.client.getBalance({ address: buyer.wallet.primaryAccount })).toBe(
    before + parseEther('2'),
  );

  // And the buyer can transact back from its own wallet.
  const replied = await sendFromPage(buyer.page, {
    to: wallet.primaryAccount,
    value: `0x${parseEther('1').toString(16)}`,
  });
  expect(replied.ok).toBe(true);
  expect(buyer.wallet.sentTransactions).toHaveLength(1);
  expect(wallet.sentTransactions).toHaveLength(1);
});

test('default account assignment hands out 1, 2, … in creation order', async ({
  chain,
  createUser,
}) => {
  const accounts = await chain.accounts();
  const first = await createUser();
  const second = await createUser();
  expect(first.wallet.primaryAccount).toBe(accounts[1]);
  expect(second.wallet.primaryAccount).toBe(accounts[2]);

  // Explicit selections do not consume the default sequence.
  const third = await createUser({ accountIndexes: [5] });
  const fourth = await createUser();
  expect(third.wallet.primaryAccount).toBe(accounts[5]);
  expect(fourth.wallet.primaryAccount).toBe(accounts[3]);
});

test('accountIndexes out of range names the anvil accounts option', async ({ createUser }) => {
  await expect(createUser({ accountIndexes: [40] })).rejects.toThrow(/anvilOptions: \{ accounts/);
});

test('a second controller on an existing user context is still rejected', async ({
  chain,
  createUser,
}) => {
  const user = await createUser();
  const accounts = await chain.accounts();
  const duplicate = new MockWalletController(user.page, chain, {
    accounts: [accounts[3]!],
    chainId: chain.chainId,
  });
  await expect(duplicate.injectMockProvider()).rejects.toThrow(/already injected/);
});

test('UserSession.close is idempotent and usable mid-test', async ({ createUser }) => {
  const user = await createUser();
  await user.page.setContent('<main>leaving</main>');
  await user.close();
  await user.close();
  expect(user.context.pages()).toHaveLength(0);
});

test.describe('walletOptions inherit into createUser sessions', () => {
  test.use({ walletOptions: { autoApprove: false } });

  test('deny-mode applies to every user by default', async ({ createUser }) => {
    const user = await createUser();
    await user.page.setContent('<main>deny</main>');

    const denied = await sendFromPage(user.page, {
      to: SENTINEL,
      value: '0x1',
    });
    expect(denied).toMatchObject({ ok: false, code: 4001 });

    // Per-call overrides still win over the inherited base.
    const trusted = await createUser({ autoApprove: true });
    await trusted.page.setContent('<main>allow</main>');
    const sent = await sendFromPage(trusted.page, { to: SENTINEL, value: '0x1' });
    expect(sent.ok).toBe(true);
  });
});

test.describe('chain isolation covers createUser-only tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('a createUser-only test mutates the chain', async ({ chain, createUser }) => {
    const user = await createUser();
    await user.page.setContent('<main>mutate</main>');
    const sent = await sendFromPage(user.page, {
      to: SENTINEL,
      value: `0x${parseEther('1').toString(16)}`,
    });
    expect(sent.ok).toBe(true);
    expect(await chain.client.getBalance({ address: SENTINEL })).toBe(parseEther('1'));
  });

  test('the mutation reverted after the previous test', async ({ chain, createUser }) => {
    // Referencing createUser (not wallet) pins that isolation does not
    // depend on the primary wallet fixture.
    void createUser;
    expect(await chain.client.getBalance({ address: SENTINEL })).toBe(0n);
  });
});
