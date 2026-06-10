import { parseEther, verifyMessage, verifyTypedData, type Hex } from 'viem';
import { expect, test } from '../src/fixtures.js';

const RECIPIENT = '0x000000000000000000000000000000000000beef' as const;

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

test.describe('transactions through the injected wallet', () => {
  test('eth_sendTransaction reaches anvil, moves funds, and is recorded', async ({ page, chain, wallet }) => {
    const before = await chain.client.getBalance({ address: RECIPIENT });

    const response = await requestFromPage(page, 'eth_sendTransaction', [
      { to: RECIPIENT, value: `0x${parseEther('1').toString(16)}` },
    ]);

    expect(response.ok).toBe(true);
    const hash = response.ok ? (response.result as Hex) : ('0x' as Hex);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    const after = await chain.client.getBalance({ address: RECIPIENT });
    expect(after - before).toBe(parseEther('1'));

    expect(wallet.sentTransactions).toEqual([hash]);
    expect(wallet.sentTransactionRequests[0]).toMatchObject({
      hash,
      from: wallet.primaryAccount,
      to: RECIPIENT,
    });
  });

  test('waitForNextTransaction resolves with the submitted hash', async ({ page, wallet }) => {
    const pending = wallet.waitForNextTransaction();

    const response = await requestFromPage(page, 'eth_sendTransaction', [
      { to: RECIPIENT, value: `0x${parseEther('0.1').toString(16)}` },
    ]);

    expect(response.ok).toBe(true);
    expect(await pending).toBe(response.ok ? response.result : undefined);
  });
});

test.describe('signing through anvil accounts', () => {
  test('personal_sign produces a verifiable signature', async ({ page, wallet }) => {
    const response = await requestFromPage(page, 'personal_sign', [
      '0x68656c6c6f', // "hello"
      wallet.primaryAccount,
    ]);

    expect(response.ok).toBe(true);
    expect(
      await verifyMessage({
        address: wallet.primaryAccount,
        message: 'hello',
        signature: (response.ok ? response.result : '0x') as Hex,
      }),
    ).toBe(true);
  });

  test('eth_signTypedData_v4 produces a verifiable signature', async ({ page, wallet, chain }) => {
    const typedData = {
      domain: { name: 'Mock', version: '1', chainId: chain.chainId },
      types: { Ping: [{ name: 'note', type: 'string' }] },
      primaryType: 'Ping',
      message: { note: 'pong' },
    } as const;

    const response = await requestFromPage(page, 'eth_signTypedData_v4', [
      wallet.primaryAccount,
      JSON.stringify(typedData),
    ]);

    expect(response.ok).toBe(true);
    expect(
      await verifyTypedData({
        ...typedData,
        address: wallet.primaryAccount,
        signature: (response.ok ? response.result : '0x') as Hex,
      }),
    ).toBe(true);
  });

  test('eth_signTypedData (legacy v1) returns 4200', async ({ page, wallet }) => {
    const response = await requestFromPage(page, 'eth_signTypedData', [[], wallet.primaryAccount]);
    expect(response.ok).toBe(false);
    expect((response as { error: ProviderErrorShape }).error.code).toBe(4200);
  });
});

test.describe('chain management', () => {
  test('wallet_switchEthereumChain to an unknown chain returns 4902', async ({ page, wallet }) => {
    const before = wallet.currentChainId;
    const response = await requestFromPage(page, 'wallet_switchEthereumChain', [
      { chainId: '0xaa36a7' },
    ]);

    expect(response.ok).toBe(false);
    expect((response as { error: ProviderErrorShape }).error.code).toBe(4902);
    expect(wallet.currentChainId).toBe(before);
  });

  test('wallet_addEthereumChain registers the chain, switches, and emits chainChanged', async ({ page, wallet }) => {
    await page.evaluate(() => {
      (window as { __chainEvents?: unknown[] }).__chainEvents = [];
      window.ethereum.on('chainChanged', (chainId: unknown) => {
        (window as unknown as { __chainEvents: unknown[] }).__chainEvents.push(chainId);
      });
    });

    const added = await requestFromPage(page, 'wallet_addEthereumChain', [
      { chainId: '0xaa36a7', chainName: 'Sepolia', rpcUrls: ['https://example.invalid'] },
    ]);
    expect(added.ok).toBe(true);
    expect(wallet.currentChainId).toBe('0xaa36a7');

    // Now the chain is known, switching back and forth works.
    const switched = await requestFromPage(page, 'wallet_switchEthereumChain', [
      { chainId: '0xaa36a7' },
    ]);
    expect(switched.ok).toBe(true);

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __chainEvents: unknown[] }).__chainEvents))
      .toContain('0xaa36a7');
    expect(await page.evaluate(() => window.ethereum.chainId)).toBe('0xaa36a7');
    expect(await page.evaluate(() => window.ethereum.networkVersion)).toBe('11155111');
  });

  test('controller switchNetwork survives navigation (sync mirror refresh)', async ({ page, wallet }) => {
    await wallet.switchNetwork('0xaa36a7');

    await page.goto('data:text/html,<h1>fresh page</h1>');
    await page.waitForFunction(() => window.ethereum?.chainId === '0xaa36a7');
    expect(await page.evaluate(() => window.ethereum.networkVersion)).toBe('11155111');
  });
});

test.describe('connection lifecycle', () => {
  test('wallet_revokePermissions disconnects and empties eth_accounts', async ({ page, wallet }) => {
    const revoked = await requestFromPage(page, 'wallet_revokePermissions', [
      { eth_accounts: {} },
    ]);
    expect(revoked.ok).toBe(true);

    const accounts = await requestFromPage(page, 'eth_accounts');
    expect(accounts.ok ? accounts.result : undefined).toEqual([]);
    void wallet;
  });

  test('signing while disconnected returns 4100', async ({ page, wallet }) => {
    await wallet.disconnect();

    const response = await requestFromPage(page, 'personal_sign', [
      '0x68656c6c6f',
      wallet.primaryAccount,
    ]);
    expect(response.ok).toBe(false);
    expect((response as { error: ProviderErrorShape }).error.code).toBe(4100);
  });

  test('isConnected() tracks disconnect and reconnect', async ({ page, wallet }) => {
    expect(await page.evaluate(() => window.ethereum.isConnected())).toBe(true);

    await wallet.disconnect();
    expect(await page.evaluate(() => window.ethereum.isConnected())).toBe(false);

    await wallet.reconnect();
    expect(await page.evaluate(() => window.ethereum.isConnected())).toBe(true);
  });

  test('setAccounts emits accountsChanged and updates selectedAddress', async ({ page, wallet, chain }) => {
    const [, second] = await chain.accounts();
    await page.evaluate(() => {
      (window as { __accountEvents?: unknown[] }).__accountEvents = [];
      window.ethereum.on('accountsChanged', (accounts: unknown) => {
        (window as unknown as { __accountEvents: unknown[] }).__accountEvents.push(accounts);
      });
    });

    await wallet.setAccounts([second!]);

    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __accountEvents: unknown[][] }).__accountEvents.length),
      )
      .toBeGreaterThan(0);
    expect(
      (await page.evaluate(() => window.ethereum.selectedAddress))?.toLowerCase(),
    ).toBe(second!.toLowerCase());
  });
});

test.describe('approval controls', () => {
  test('autoApprove(false) rejects prompt methods like wallet_watchAsset', async ({ page, wallet }) => {
    wallet.autoApprove(false);

    const response = await requestFromPage(page, 'wallet_watchAsset', {
      type: 'ERC20',
      options: { address: RECIPIENT, symbol: 'BEEF', decimals: 18 },
    });
    expect(response.ok).toBe(false);
    expect((response as { error: ProviderErrorShape }).error.code).toBe(4001);
  });

  test('default simulateRejection covers eth_requestAccounts', async ({ page, wallet }) => {
    await wallet.simulateRejection();

    const response = await requestFromPage(page, 'eth_requestAccounts');
    expect(response.ok).toBe(false);
    expect((response as { error: ProviderErrorShape }).error.code).toBe(4001);

    // The rule is consumed: the next request succeeds.
    const retry = await requestFromPage(page, 'eth_requestAccounts');
    expect(retry.ok).toBe(true);
  });

  test('holdNextRequest keeps the request pending until approved', async ({ page, wallet }) => {
    const held = wallet.holdNextRequest('eth_sendTransaction');

    const responsePromise = requestFromPage(page, 'eth_sendTransaction', [
      { to: RECIPIENT, value: `0x${parseEther('0.01').toString(16)}` },
    ]);

    const request = await held;
    expect(request.method).toBe('eth_sendTransaction');

    // While held, the page request must still be pending.
    const settled = await Promise.race([
      responsePromise.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 250)),
    ]);
    expect(settled).toBe('pending');

    request.approve();
    const response = await responsePromise;
    expect(response.ok).toBe(true);
    expect(response.ok ? response.result : '').toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('holdNextRequest reject surfaces 4001 to the page', async ({ page, wallet }) => {
    const held = wallet.holdNextRequest('personal_sign');

    const responsePromise = requestFromPage(page, 'personal_sign', [
      '0x68656c6c6f',
      wallet.primaryAccount,
    ]);

    (await held).reject('Nope.');
    const response = await responsePromise;
    expect(response.ok).toBe(false);
    expect((response as { error: ProviderErrorShape }).error).toMatchObject({
      code: 4001,
      message: 'Nope.',
    });
  });
});

test.describe('provider surface', () => {
  test('permissions carry the restrictReturnedAccounts caveat', async ({ page, wallet }) => {
    const response = await requestFromPage(page, 'wallet_getPermissions');
    expect(response.ok).toBe(true);
    expect(response.ok ? response.result : []).toEqual([
      {
        parentCapability: 'eth_accounts',
        caveats: [{ type: 'restrictReturnedAccounts', value: [wallet.primaryAccount] }],
      },
    ]);
  });

  test('unknown wallet_* methods return 4200 instead of a node error', async ({ page, wallet }) => {
    void wallet; // fixtures are lazy: the provider is only injected when referenced
    const response = await requestFromPage(page, 'wallet_definitelyNotAMethod');
    expect(response.ok).toBe(false);
    expect((response as { error: ProviderErrorShape }).error.code).toBe(4200);
  });

  test('legacy enable/send/sendAsync surface works', async ({ page, wallet }) => {
    const viaEnable = await page.evaluate(() => window.ethereum.enable());
    expect((viaEnable as string[])[0]?.toLowerCase()).toBe(wallet.primaryAccount.toLowerCase());

    const viaSendString = await page.evaluate(() => window.ethereum.send('eth_chainId'));
    expect(viaSendString).toBe(wallet.currentChainId);

    const viaSendAsync = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          window.ethereum.sendAsync(
            { id: 1, jsonrpc: '2.0', method: 'eth_accounts', params: [] },
            (error: unknown, response: { result?: unknown }) =>
              error ? reject(error) : resolve(response.result),
          );
        }),
    );
    expect((viaSendAsync as string[])[0]?.toLowerCase()).toBe(wallet.primaryAccount.toLowerCase());
  });

  test('popup windows opened by the page get the provider too', async ({ page, context, wallet }) => {
    void wallet;
    await page.goto('data:text/html,<button>open</button>');

    const popupPromise = context.waitForEvent('page');
    await page.evaluate(() => {
      // Chromium blocks window.open to data: URLs; about:blank is enough to
      // prove context-level injection reaches dapp-opened windows.
      window.open('about:blank');
    });
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    await popup.waitForFunction(() => typeof window.ethereum?.request === 'function');
    const chainId = await popup.evaluate(() => window.ethereum.request({ method: 'eth_chainId' }));
    expect(chainId).toMatch(/^0x/);
  });
});

test.describe('EIP-6963 multi-provider announcements', () => {
  test.use({
    walletOptions: {
      additionalProviders: [
        { name: 'Mock Rabby', rdns: 'io.rabby' },
        { name: 'Mock Rainbow', rdns: 'me.rainbow' },
      ],
    },
  });

  test('announces one distinct, frozen provider per configured wallet', async ({ page, wallet }) => {
    const summary = await page.evaluate(() => {
      const announcements: {
        rdns: string;
        frozenDetail: boolean;
        frozenInfo: boolean;
        isWindowEthereum: boolean;
      }[] = [];
      const seenProviders: unknown[] = [];

      window.addEventListener('eip6963:requestProvider', () => undefined);
      window.addEventListener('eip6963:announceProvider', (event) => {
        const detail = (event as CustomEvent<{ info: { rdns: string }; provider: unknown }>).detail;
        announcements.push({
          rdns: detail.info.rdns,
          frozenDetail: Object.isFrozen(detail),
          frozenInfo: Object.isFrozen(detail.info),
          isWindowEthereum: detail.provider === window.ethereum,
        });
        seenProviders.push(detail.provider);
      });
      window.dispatchEvent(new Event('eip6963:requestProvider'));

      return {
        announcements,
        distinctProviders: new Set(seenProviders).size,
      };
    });

    expect(summary.announcements.map((a) => a.rdns)).toEqual(
      wallet.providerInfos.map((info) => info.rdns),
    );
    expect(summary.distinctProviders).toBe(3);
    expect(summary.announcements.every((a) => a.frozenDetail && a.frozenInfo)).toBe(true);
    // Only the primary provider is window.ethereum.
    expect(summary.announcements.map((a) => a.isWindowEthereum)).toEqual([true, false, false]);
  });
});
