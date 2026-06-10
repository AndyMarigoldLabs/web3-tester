import http from 'node:http';
import { once } from 'node:events';
import { recoverMessageAddress, type Hex } from 'viem';
import { AnvilInstance, ChainController } from '../src/anvil.js';
import { expect, test } from '../src/real-wallet-fixtures.js';

/**
 * Opt-in end-to-end validation of the real MetaMask adapter against the
 * pinned extension build: downloads MetaMask, builds a cached profile from a
 * throwaway seed, adds/switches to a local Anvil network, then exercises
 * connect, personal_sign confirm, transaction confirm, and rejection.
 *
 * Run with: WEB3_TESTER_REAL_WALLET_SMOKE=true npm test -- real-wallet-smoke
 */
const SMOKE = process.env.WEB3_TESTER_REAL_WALLET_SMOKE === 'true';

// The well-known anvil dev mnemonic; account #0 is funded on every anvil.
const TEST_SEED = 'test test test test test test test test test test test junk';
const ANVIL_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ANVIL_PORT = 19400;

const DAPP_HTML = `<!DOCTYPE html>
<html><body>
<h1>web3-tester smoke dapp</h1>
<pre id="out"></pre>
<script>
  const out = (value) => { document.getElementById('out').textContent = JSON.stringify(value); };
  window.connect = () => window.ethereum.request({ method: 'eth_requestAccounts' }).then(out, (e) => out({ error: e.code }));
  window.sign = (account) => window.ethereum
    .request({ method: 'personal_sign', params: ['0x7765623320746573746572', account] })
    .then(out, (e) => out({ error: e.code }));
  window.send = (account) => window.ethereum
    .request({ method: 'eth_sendTransaction', params: [{ from: account, to: '0x000000000000000000000000000000000000beef', value: '0xde0b6b3a7640000' }] })
    .then(out, (e) => out({ error: e.code }));
</script>
</body></html>`;

test.describe('real MetaMask smoke', () => {
  test.skip(!SMOKE, 'Set WEB3_TESTER_REAL_WALLET_SMOKE=true to run the real-extension smoke suite.');
  // Generous timeout: the first run downloads MetaMask and walks onboarding.
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let anvil: AnvilInstance;
  let chain: ChainController;
  let server: http.Server;
  let dappUrl: string;

  test.beforeAll(async () => {
    anvil = await AnvilInstance.start({ port: ANVIL_PORT, chainId: 31337, silent: true });
    chain = new ChainController({ rpcUrl: anvil.rpcUrl, chainId: anvil.chainId });

    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(DAPP_HTML);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    dappUrl = `http://127.0.0.1:${address.port}/`;
  });

  test.afterAll(async () => {
    server?.close();
    await anvil?.stop();
  });

  test.use({
    realWalletOptions: {
      setup: { seedPhrase: TEST_SEED },
    },
  });

  test('full journey: import, add network, connect, sign, send, reject', async ({ page, realWallet }) => {
    // 1. The cached profile imported the right wallet.
    const address = await realWallet.getAccountAddress();
    expect(address.toLowerCase()).toBe(ANVIL_ACCOUNT_0.toLowerCase());

    // 2. Wallet-side network management: point MetaMask at our anvil.
    await realWallet.addNetwork({
      name: 'Anvil Local',
      rpcUrl: anvil.rpcUrl,
      chainId: anvil.chainId,
      symbol: 'ETH',
    });
    await realWallet.switchNetwork('Anvil Local');

    // 3. Connect the dapp.
    await page.goto(dappUrl);
    await page.evaluate(() => {
      void window.connect();
    });
    await realWallet.connectToDapp();
    await expect(page.locator('#out')).toContainText(ANVIL_ACCOUNT_0.slice(2, 10).toLowerCase());

    // 4. personal_sign + confirm; the signature must recover to the account.
    await page.evaluate((account) => {
      void window.sign(account);
    }, ANVIL_ACCOUNT_0);
    await realWallet.confirmSignature();
    await expect(page.locator('#out')).toContainText(/^"0x/);
    const signature = JSON.parse(await page.locator('#out').innerText()) as Hex;
    const recovered = await recoverMessageAddress({ message: 'web3 tester', signature });
    expect(recovered.toLowerCase()).toBe(ANVIL_ACCOUNT_0.toLowerCase());

    // 5. Send 1 ETH through the real confirmation flow and verify on-chain.
    const balanceBefore = await chain.client.getBalance({
      address: '0x000000000000000000000000000000000000beef',
    });
    await page.evaluate((account) => {
      void window.send(account);
    }, ANVIL_ACCOUNT_0);
    await realWallet.confirmTransaction();
    await expect(page.locator('#out')).toContainText(/^"0x/, { timeout: 30_000 });
    const balanceAfter = await chain.client.getBalance({
      address: '0x000000000000000000000000000000000000beef',
    });
    expect(balanceAfter - balanceBefore).toBe(10n ** 18n);

    // 6. Rejection surfaces 4001 to the dapp.
    await page.evaluate((account) => {
      void window.send(account);
    }, ANVIL_ACCOUNT_0);
    await realWallet.rejectTransaction();
    await expect(page.locator('#out')).toContainText('4001', { timeout: 30_000 });
  });
});

declare global {
  interface Window {
    connect: () => Promise<void>;
    sign: (account: string) => Promise<void>;
    send: (account: string) => Promise<void>;
  }
}
