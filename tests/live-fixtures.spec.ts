import { expect } from '@playwright/test';
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createLiveFixtures } from '../src/live-fixtures.js';

// Well-known anvil dev key #0 — public knowledge, never holds real funds.
// Routed through a dedicated env name so this spec stays hermetic regardless
// of any ambient WEB3_TESTER_PRIVATE_KEY.
const PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const account = privateKeyToAccount(PRIVATE_KEY);
process.env.WEB3_TESTER_HERMETIC_TEST_KEY = PRIVATE_KEY;

const test = createLiveFixtures({ privateKeyEnv: 'WEB3_TESTER_HERMETIC_TEST_KEY' });

// personal_sign signs locally in the PrivateKeyRpcClient, so this exercises
// the real live-wallet plumbing without any network access.
const signFromPage = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    try {
      const result = await window.ethereum.request({
        method: 'personal_sign',
        params: ['0x68656c6c6f', window.ethereum.selectedAddress],
      });
      return { ok: true as const, result: result as string };
    } catch (error) {
      const err = error as { code?: number };
      return { ok: false as const, code: err.code, message: (err as {message?: string}).message };
    }
  });

test('live wallets refuse signing until armed, then sign exactly once', async ({ page, wallet }) => {
  await page.setContent('<main>live</main>');

  const denied = await signFromPage(page);
  expect(denied).toMatchObject({ ok: false, code: 4001 });

  wallet.approveNext('personal_sign');
  const armed = await signFromPage(page);
  expect(armed.ok).toBe(true);

  // The signature must come from the configured env key — pins the
  // privateKeyEnv plumbing end to end.
  const recovered = await recoverMessageAddress({
    message: { raw: '0x68656c6c6f' },
    signature: (armed.ok ? armed.result : '0x') as `0x${string}`,
  });
  expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());

  // The grant was single-use.
  const deniedAgain = await signFromPage(page);
  expect(deniedAgain).toMatchObject({ ok: false, code: 4001 });
});

// `wallet` must be requested so the fixture injects the provider.
test('live wallets refuse the spend paths until armed', async ({ page, wallet }) => {
  expect(wallet.primaryAccount).toBe(account.address);
  await page.setContent('<main>live</main>');

  const result = await page.evaluate(async () => {
    const attempt = async (method: string, params: unknown) => {
      try {
        await window.ethereum.request({ method, params });
        return { ok: true };
      } catch (error) {
        return { ok: false, code: (error as { code?: number }).code, message: (error as { message?: string }).message };
      }
    };
    return {
      send: await attempt('eth_sendTransaction', [{ to: '0x000000000000000000000000000000000000beef', value: '0x1' }]),
      raw: await attempt('eth_sendRawTransaction', ['0x02deadbeef']),
      connect: await attempt('eth_requestAccounts', []),
    };
  });

  expect(result.send).toMatchObject({ ok: false, code: 4001 });
  expect(result.raw).toMatchObject({ ok: false, code: 4001 });
  expect(result.connect).toMatchObject({ ok: false, code: 4001 });
});

test('autoApprove(true) is an explicit whole-test opt-in', async ({ page, wallet }) => {
  await page.setContent('<main>live</main>');

  wallet.autoApprove(true);
  const first = await signFromPage(page);
  const second = await signFromPage(page);
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
});

test.describe('per-test opt-in via liveOptions (the pattern the QA suites use)', () => {
  test.use({ liveOptions: { walletOptions: { autoApprove: true } } });

  test('walletOptions.autoApprove restores auto-signing', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toBe(account.address);
    await page.setContent('<main>live</main>');
    expect((await signFromPage(page)).ok).toBe(true);
  });
});

test.describe('origin scoping from baseURL', () => {
  test.use({ baseURL: 'https://dapp.test' });

  test('the provider only exists on the baseURL origin', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toBe(account.address);
    await page.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>page</body></html>' }),
    );

    await page.goto('https://dapp.test/');
    expect(await page.evaluate(() => 'ethereum' in window)).toBe(true);

    await page.goto('https://elsewhere.test/');
    expect(await page.evaluate(() => 'ethereum' in window)).toBe(false);
  });
});
