import { expect, test } from '../src/fixtures.js';

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
