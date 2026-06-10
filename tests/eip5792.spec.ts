import { parseEther } from 'viem';
import { expect, test } from '../src/fixtures.js';

const RECIPIENT = '0x000000000000000000000000000000000000beef' as const;
// Runtime 0x60006000fd: always reverts. anvil MINES such calls with status
// 0x0 (no submission error), which is exactly what the receipt-checked
// execution loop exists to catch.
const REVERTER = '0x00000000000000000000000000000000000bad00' as const;

type ProviderErrorShape = { code: number; message: string };

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

const sendCalls = (
  page: import('@playwright/test').Page,
  overrides: Record<string, unknown> = {},
) =>
  requestFromPage(page, 'wallet_sendCalls', [
    {
      version: '2.0.0',
      chainId: '0x7a69',
      atomicRequired: true,
      calls: [
        { to: RECIPIENT, value: `0x${parseEther('1').toString(16)}` },
        { to: RECIPIENT, value: `0x${parseEther('2').toString(16)}` },
      ],
      ...overrides,
    },
  ]);

test.describe('wallet_getCapabilities', () => {
  test('answers per backed chain and filters by chainIds', async ({ page, wallet }) => {
    const all = await requestFromPage(page, 'wallet_getCapabilities', [wallet.primaryAccount]);
    expect(all.ok ? all.result : {}).toEqual({
      '0x7a69': { atomic: { status: 'supported' } },
    });

    const filtered = await requestFromPage(page, 'wallet_getCapabilities', [
      wallet.primaryAccount,
      ['0x1'],
    ]);
    expect(filtered.ok ? filtered.result : null).toEqual({});
  });

  test('refuses foreign accounts with 4100 (spec privacy rule)', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    const response = await requestFromPage(page, 'wallet_getCapabilities', [RECIPIENT]);
    expect((response as { error: ProviderErrorShape }).error.code).toBe(4100);
  });
});

test.describe('wallet_sendCalls happy path', () => {
  test('executes the batch atomically with real receipts', async ({ page, wallet, chain }) => {
    const before = await chain.client.getBalance({ address: RECIPIENT });

    const submitted = await sendCalls(page);
    expect(submitted.ok).toBe(true);
    const { id } = submitted.ok ? (submitted.result as { id: string }) : { id: '' };
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);

    expect(wallet.sentTransactions).toHaveLength(2);
    expect(wallet.sentCallBatches).toHaveLength(1);
    expect(wallet.sentCallBatches[0]).toMatchObject({
      id,
      chainId: '0x7a69',
      atomic: true,
      atomicRequired: true,
    });

    const status = await requestFromPage(page, 'wallet_getCallsStatus', [id]);
    expect(status.ok).toBe(true);
    const result = status.ok ? (status.result as Record<string, unknown>) : {};
    expect(result).toMatchObject({ version: '2.0.0', id, chainId: '0x7a69', status: 200, atomic: true });
    expect(result.receipts).toHaveLength(2);
    expect((result.receipts as Array<{ transactionHash: string }>).map((r) => r.transactionHash)).toEqual(
      [...wallet.sentTransactions],
    );

    expect(await chain.client.getBalance({ address: RECIPIENT })).toBe(before + parseEther('3'));

    const shown = await requestFromPage(page, 'wallet_showCallsStatus', [id]);
    expect(shown).toEqual({ ok: true, result: null });
    expect(wallet.shownCallsStatusIds).toEqual([id]);
  });
});

test.describe('wallet_sendCalls validation matrix', () => {
  const expectCode = async (
    page: import('@playwright/test').Page,
    overrides: Record<string, unknown>,
    code: number,
  ) => {
    const response = await sendCalls(page, overrides);
    expect(response.ok, JSON.stringify(overrides)).toBe(false);
    expect((response as { error: ProviderErrorShape }).error.code, JSON.stringify(overrides)).toBe(code);
  };

  test('-32602 for malformed params', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await expectCode(page, { version: '1.0' }, -32602);
    await expectCode(page, { calls: [] }, -32602);
    await expectCode(page, { atomicRequired: 'yes' }, -32602);
    await expectCode(page, { chainId: 'banana' }, -32602);
    await expectCode(page, { id: 'not-hex' }, -32602);
  });

  test('4100 for a from outside the wallet', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await expectCode(page, { from: RECIPIENT }, 4100);
  });

  test('5710 for a chain that is not the active backed chain', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await expectCode(page, { chainId: '0x1' }, 5710);
  });

  test('5710 after a cosmetic switch to an unbacked chain', async ({ page, wallet }) => {
    await wallet.switchNetwork('0xaa36a7');
    await expectCode(page, { chainId: '0xaa36a7' }, 5710);
  });

  test('5720 for a duplicate id', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    const first = await sendCalls(page, { id: '0xabcdef' });
    expect(first.ok).toBe(true);
    await expectCode(page, { id: '0xabcdef' }, 5720);
  });

  test('5700 for an unknown non-optional capability; optional passes', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await expectCode(page, { capabilities: { paymasterService: { url: 'https://x' } } }, 5700);

    const optional = await sendCalls(page, {
      capabilities: { paymasterService: { url: 'https://x', optional: true } },
    });
    expect(optional.ok).toBe(true);
  });

  test('5730 for unknown bundle ids on both status methods', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    for (const method of ['wallet_getCallsStatus', 'wallet_showCallsStatus']) {
      const response = await requestFromPage(page, method, ['0x1234']);
      expect((response as { error: ProviderErrorShape }).error.code).toBe(5730);
    }
  });
});

test.describe('batch size limit', () => {
  test.use({ walletOptions: { eip5792: { maxCallsPerBatch: 2 } } });

  test('5740 above maxCallsPerBatch', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    const response = await sendCalls(page, {
      calls: [{ to: RECIPIENT }, { to: RECIPIENT }, { to: RECIPIENT }],
    });
    expect((response as { error: ProviderErrorShape }).error.code).toBe(5740);
  });
});

test.describe('approval gating', () => {
  test('one approveNext arms the whole batch; rejection sends nothing', async ({ page, wallet }) => {
    wallet.autoApprove(false);

    const denied = await sendCalls(page);
    expect((denied as { error: ProviderErrorShape }).error.code).toBe(4001);
    expect(wallet.sentTransactions).toHaveLength(0);

    wallet.approveNext('wallet_sendCalls');
    const armed = await sendCalls(page);
    expect(armed.ok).toBe(true);
    expect(wallet.sentTransactions).toHaveLength(2);

    await wallet.simulateRejection('wallet_sendCalls', 'Nope.');
    const rejected = await sendCalls(page);
    expect((rejected as { error: ProviderErrorShape }).error).toMatchObject({ code: 4001, message: 'Nope.' });
    expect(wallet.sentTransactions).toHaveLength(2); // unchanged — spec MUST
  });
});

test.describe('atomic rollback', () => {
  test('a mined revert mid-batch rolls everything back: 500 without receipts', async ({ page, wallet, chain }) => {
    await chain.setCode(REVERTER, '0x60006000fd');
    const before = await chain.client.getBalance({ address: RECIPIENT });

    const submitted = await sendCalls(page, {
      calls: [
        { to: RECIPIENT, value: `0x${parseEther('1').toString(16)}` },
        { to: REVERTER, data: '0x01' },
      ],
    });
    expect(submitted.ok).toBe(true);
    const { id } = submitted.result as { id: string };

    const status = await requestFromPage(page, 'wallet_getCallsStatus', [id]);
    const result = status.ok ? (status.result as Record<string, unknown>) : {};
    expect(result).toMatchObject({ status: 500, atomic: true });
    expect(result.receipts).toBeUndefined();

    // The first call's transfer was reverted with the snapshot.
    expect(await chain.client.getBalance({ address: RECIPIENT })).toBe(before);
    expect(wallet.sentCallBatches[0]?.failure).toBe('atomic-rollback');
  });
});

test.describe('non-atomic execution', () => {
  test.use({ walletOptions: { eip5792: { atomic: 'unsupported' } } });

  test('atomicRequired is refused with 5760', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    const response = await sendCalls(page, { atomicRequired: true });
    expect((response as { error: ProviderErrorShape }).error.code).toBe(5760);
  });

  test('stops at the first mined revert: 600 with landed receipts', async ({ page, wallet, chain }) => {
    await chain.setCode(REVERTER, '0x60006000fd');

    const submitted = await sendCalls(page, {
      atomicRequired: false,
      calls: [
        { to: RECIPIENT, value: '0x1' },
        { to: REVERTER, data: '0x01' },
        { to: RECIPIENT, value: '0x1' }, // never sent
      ],
    });
    expect(submitted.ok).toBe(true);
    const { id } = submitted.result as { id: string };

    expect(wallet.sentTransactions).toHaveLength(2);

    const status = await requestFromPage(page, 'wallet_getCallsStatus', [id]);
    const result = status.ok ? (status.result as Record<string, unknown>) : {};
    expect(result).toMatchObject({ status: 600, atomic: false });
    expect(result.receipts).toHaveLength(2);
  });

  test('a single-call batch that mines reverted is 500, not 600', async ({ page, wallet, chain }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await chain.setCode(REVERTER, '0x60006000fd');

    const submitted = await sendCalls(page, {
      atomicRequired: false,
      calls: [{ to: REVERTER, data: '0x01' }],
    });
    const { id } = submitted.result as { id: string };

    const status = await requestFromPage(page, 'wallet_getCallsStatus', [id]);
    expect((status.ok ? status.result : {}) as Record<string, unknown>).toMatchObject({ status: 500 });
  });
});

test.describe('atomic ready → supported upgrade', () => {
  test.use({ walletOptions: { eip5792: { atomic: 'ready' } } });

  test('first atomicRequired success flips the capability; armed rejection yields 5750', async ({ page, wallet }) => {
    wallet.simulateAtomicUpgradeRejection();
    const refused = await sendCalls(page);
    expect((refused as { error: ProviderErrorShape }).error.code).toBe(5750);

    const accepted = await sendCalls(page);
    expect(accepted.ok).toBe(true);

    const capabilities = await requestFromPage(page, 'wallet_getCapabilities', [wallet.primaryAccount]);
    expect(capabilities.ok ? capabilities.result : {}).toEqual({
      '0x7a69': { atomic: { status: 'supported' } },
    });
  });
});

test.describe('legacy wallets (eip5792: false)', () => {
  test.use({ walletOptions: { eip5792: false } });

  test('all four methods answer 4200', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    for (const [method, params] of [
      ['wallet_getCapabilities', [wallet.primaryAccount]],
      ['wallet_sendCalls', [{ version: '2.0.0', chainId: '0x7a69', atomicRequired: false, calls: [{ to: RECIPIENT }] }]],
      ['wallet_getCallsStatus', ['0x1234']],
      ['wallet_showCallsStatus', ['0x1234']],
    ] as const) {
      const response = await requestFromPage(page, method, params as unknown);
      expect((response as { error: ProviderErrorShape }).error.code, method).toBe(4200);
    }
  });
});
