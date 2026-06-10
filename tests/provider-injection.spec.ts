import { expect, test } from '../src/fixtures.js';
import { MockWalletController } from '../src/mock-wallet-controller.js';

test('injects an EIP-1193 and EIP-6963 mock wallet before app scripts run', async ({ page, wallet }) => {
  expect(wallet.primaryAccount).toMatch(/^0x/);

  const html = `
    <script>
      window.detected = {
        hasEthereum: Boolean(window.ethereum),
        chainId: window.ethereum?.chainId,
        accounts: undefined,
        announcements: 0,
      };

      window.addEventListener('eip6963:announceProvider', (event) => {
        window.detected.announcements += Number(event.detail.info.name === 'Mock Wallet');
      });

      window.dispatchEvent(new Event('eip6963:requestProvider'));
    </script>
  `;

  await page.goto(`data:text/html,${encodeURIComponent(html)}`);

  const detected = await page.evaluate(async () => {
    window.detected.accounts = (await window.ethereum.request({
      method: 'eth_accounts',
    })) as string[];
    return window.detected;
  });

  expect(detected.hasEthereum).toBe(true);
  expect(detected.chainId).toBe('0x7a69');
  expect(detected.accounts).toEqual([wallet.primaryAccount]);
  expect(detected.announcements).toBeGreaterThan(0);
});

test.describe('origin scoping', () => {
  test.use({ walletOptions: { allowedOrigins: ['https://dapp.test'] } });

  const requestAccounts = `
    async () => {
      try {
        return { ok: true, result: await window.ethereum.request({ method: 'eth_accounts' }) };
      } catch (error) {
        return { ok: false, code: error.code, message: error.message };
      }
    }
  `;

  // The bridge binding exists in every frame even where the provider script
  // declined to install — this probes the authoritative server-side check.
  const callBridgeDirectly = `
    async () => {
      const envelope = await window.__invisibleWalletRpcBridge({ method: 'eth_accounts', params: [] });
      return envelope.ok ? { ok: true } : { ok: false, code: envelope.error.code, message: envelope.error.message };
    }
  `;

  test('serves the allowed origin and hides the wallet from frames on other origins', async ({ page, wallet }) => {
    await page.route('**/*', (route) => {
      const body = route.request().url().startsWith('https://evil.test')
        ? '<html><body>embedded</body></html>'
        : '<html><body>dapp<iframe src="https://evil.test/embed"></iframe></body></html>';
      return route.fulfill({ contentType: 'text/html', body });
    });

    await page.goto('https://dapp.test/');

    const allowed = (await page.evaluate(`(${requestAccounts})()`)) as {
      ok: boolean;
      result?: string[];
    };
    expect(allowed.ok).toBe(true);
    expect(allowed.result).toEqual([wallet.primaryAccount]);

    const embedded = page.frames().find((frame) => frame.url().startsWith('https://evil.test'));
    expect(embedded).toBeDefined();

    // The provider never installs out of scope, so the account address and
    // chain are not even readable there.
    expect(await embedded!.evaluate(() => 'ethereum' in window)).toBe(false);

    // And the bridge itself refuses the frame even if a script finds it.
    const blocked = (await embedded!.evaluate(`(${callBridgeDirectly})()`)) as {
      ok: boolean;
      code?: number;
      message?: string;
    };
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe(4100);
    expect(blocked.message).toContain('https://evil.test');
  });

  // `wallet` must be requested so the fixture injects the provider.
  test('refuses pages outside the allowlist entirely', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await page.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>elsewhere</body></html>' }),
    );

    await page.goto('https://elsewhere.test/');

    expect(await page.evaluate(() => 'ethereum' in window)).toBe(false);
    const blocked = (await page.evaluate(`(${callBridgeDirectly})()`)) as { ok: boolean; code?: number };
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe(4100);
  });

  test('same-origin about:blank iframes inherit the parent origin and are served', async ({ page, wallet }) => {
    await page.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>dapp</body></html>' }),
    );

    await page.goto('https://dapp.test/');
    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
    });

    const blank = page.frames().find((frame) => frame !== page.mainFrame());
    expect(blank).toBeDefined();
    const served = (await blank!.evaluate(`(${callBridgeDirectly})()`)) as { ok: boolean };
    expect(served.ok).toBe(true);

    // The provider also installs there: window.origin inherits the parent.
    expect(await blank!.evaluate(() => 'ethereum' in window)).toBe(true);
    expect(
      (await blank!.evaluate(`(${requestAccounts})()`)) as { ok: boolean; result?: string[] },
    ).toEqual({ ok: true, result: [wallet.primaryAccount] });
  });
});

test('rejects malformed allowedOrigins entries at construction', async ({ page }) => {
  // 'localhost:3000' is the treacherous case: it PARSES as a URL with
  // protocol "localhost:" and origin "null", which would invert the
  // allowlist. Only http(s) entries are accepted.
  for (const entry of ['dapp.test', 'localhost:3000', 'file:///tmp/x']) {
    expect(
      () =>
        new MockWalletController(
          page,
          { request: async () => null },
          {
            accounts: ['0x000000000000000000000000000000000000beef'],
            chainId: 31337,
            allowedOrigins: [entry],
          },
        ),
      entry,
    ).toThrow(/not an http\(s\) URL or origin/);
  }
});

test('can reject the next signing request with a wallet-shaped error', async ({ page, wallet }) => {
  await page.setContent('<main>ready</main>');
  await wallet.simulateRejection('personal_sign');

  const rejection = await page.evaluate(async () => {
    try {
      await window.ethereum.request({
        method: 'personal_sign',
        params: ['0x68656c6c6f', window.ethereum.selectedAddress],
      });
      return null;
    } catch (error) {
      const walletError = error as { code: number; message: string };
      return {
        code: walletError.code,
        message: walletError.message,
      };
    }
  });

  expect(rejection).toEqual({
    code: 4001,
    message: 'User rejected the request.',
  });
});
