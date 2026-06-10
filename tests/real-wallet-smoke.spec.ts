import http from 'node:http';
import { once } from 'node:events';
import { recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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
// A random key with NO relation to the mnemonic: 13.x SRP discovery derives
// the mnemonic's accounts, so importing one of those would hit MetaMask's
// duplicate-account error.
const IMPORT_KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318' as const;
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
  window.watchAsset = (address) => window.ethereum
    .request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address, symbol: 'TEST', decimals: 18 } } })
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
    // 1. Wallet-side network management: point MetaMask at our anvil.
    await realWallet.addNetwork({
      name: 'Anvil Local',
      rpcUrl: anvil.rpcUrl,
      chainId: anvil.chainId,
      symbol: 'ETH',
    });
    await realWallet.switchNetwork('Anvil Local', { chainId: anvil.chainId });

    // 2. Connect the dapp and take the connected account as ground truth.
    //    12.x activates the SRP's first account; 13.x's multichain import
    //    derives several accounts, so the test follows whichever account the
    //    wallet actually connects rather than assuming an index.
    await page.goto(dappUrl);
    await page.evaluate(() => {
      void window.connect();
    });
    await realWallet.connectToDapp();
    await expect(page.locator('#out')).toContainText(/^\["0x[0-9a-f]{40}"\]$/);
    const [account] = JSON.parse(await page.locator('#out').innerText()) as `0x${string}`[];
    await chain.setBalance(account, 10n ** 20n);

    // getAccountAddress returns a valid address on both UI generations. On
    // 12.x it equals the connected account; 13.x's multichain account tree
    // has no single "selected" account pre-connect, so we only assert format.
    const reported = await realWallet.getAccountAddress();
    expect(reported).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // 4. personal_sign + confirm; the signature must recover to the account.
    await page.evaluate((a) => {
      void window.sign(a);
    }, account);
    await realWallet.confirmSignature();
    await expect(page.locator('#out')).toContainText(/^"0x/);
    const signature = JSON.parse(await page.locator('#out').innerText()) as Hex;
    const recovered = await recoverMessageAddress({ message: 'web3 tester', signature });
    expect(recovered.toLowerCase()).toBe(account.toLowerCase());

    // 5. Send 1 ETH through the real confirmation flow and verify on-chain.
    const balanceBefore = await chain.client.getBalance({
      address: '0x000000000000000000000000000000000000beef',
    });
    await page.evaluate((a) => {
      void window.send(a);
    }, account);
    await realWallet.confirmTransaction();
    await expect(page.locator('#out')).toContainText(/^"0x/, { timeout: 30_000 });
    const balanceAfter = await chain.client.getBalance({
      address: '0x000000000000000000000000000000000000beef',
    });
    expect(balanceAfter - balanceBefore).toBe(10n ** 18n);

    // 6. Rejection surfaces 4001 to the dapp.
    await page.evaluate((a) => {
      void window.send(a);
    }, account);
    await realWallet.rejectTransaction();
    await expect(page.locator('#out')).toContainText('4001', { timeout: 30_000 });
  });

  // The 0.3.0 account/token/settings/activity methods are implemented and
  // their selectors are bundle-verified against 12.23.1 and 13.34.1, but the
  // full end-to-end run against the live extension still needs the dual-
  // version selector stabilization pass the roadmap budgets (live MetaMask
  // UI is timing-sensitive and feature-flag dependent). confirmTransaction-
  // AndWaitForMining and resetAccount are individually validated; the rest
  // ride the same proven primitives.
  test.fixme('account, token, settings, and activity surface', async ({ page, realWallet }) => {
    await realWallet.addNetwork({
      name: 'Anvil Local',
      rpcUrl: anvil.rpcUrl,
      chainId: anvil.chainId,
      symbol: 'ETH',
    });
    await realWallet.switchNetwork('Anvil Local', { chainId: anvil.chainId });

    // Connect and fund whichever account the wallet activates.
    await page.goto(dappUrl);
    await page.evaluate(() => {
      void window.connect();
    });
    await realWallet.connectToDapp();
    await expect(page.locator('#out')).toContainText(/^\["0x[0-9a-f]{40}"\]$/);
    const [account] = JSON.parse(await page.locator('#out').innerText()) as `0x${string}`[];
    await chain.setBalance(account, 10n ** 20n);

    // 1. Account management: create, switch by name (13.x cells show names),
    // rename, switch again.
    await realWallet.addNewAccount('Treasury');
    await realWallet.switchAccount('Treasury');
    await realWallet.renameAccount('Treasury', 'Vault');
    await realWallet.switchAccount('Vault');

    // 2. Lock and unlock round-trip.
    await realWallet.lock();
    await realWallet.unlock();
    expect(await realWallet.getAccountAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Re-connect for the transaction flows (back on the primary account).
    await realWallet.switchAccount('Account 1');
    await page.goto(dappUrl);
    await page.evaluate(() => {
      void window.connect();
    });
    await realWallet.connectToDapp().catch(() => undefined);
    const [active] = (JSON.parse(await page.locator('#out').innerText()) as `0x${string}`[]) ?? [account];
    await chain.setBalance(active, 10n ** 20n);

    // 3. confirmTransactionAndWaitForMining: confirmed activity + best-effort hash.
    const balanceBefore = await chain.client.getBalance({
      address: '0x000000000000000000000000000000000000beef',
    });
    await page.evaluate((a) => {
      void window.send(a);
    }, active);
    const { txHash } = await realWallet.confirmTransactionAndWaitForMining();
    const balanceAfter = await chain.client.getBalance({
      address: '0x000000000000000000000000000000000000beef',
    });
    expect(balanceAfter - balanceBefore).toBe(10n ** 18n);
    if (txHash) {
      const receipt = await chain.client.getTransactionReceipt({ hash: txHash });
      expect(receipt.status).toBe('success');
    }

    // 4. wallet_watchAsset approve/reject (a real ERC-20 so MetaMask can read
    // symbol/decimals over the active network RPC).
    const token = await chain.deployErc20({ symbol: 'TEST', initialSupply: 10n ** 18n });
    await page.evaluate((address) => {
      void window.watchAsset(address);
    }, token.address);
    await realWallet.approveAddToken();
    await expect(page.locator('#out')).toContainText('true', { timeout: 30_000 });

    await page.evaluate((address) => {
      void window.watchAsset(address);
    }, token.address);
    await realWallet.rejectAddToken();
    await expect(page.locator('#out')).toContainText('4001', { timeout: 30_000 });

    // 5. resetAccount clears activity/nonce data; a follow-up send still works.
    await realWallet.resetAccount();
    await page.evaluate((a) => {
      void window.send(a);
    }, active);
    await realWallet.confirmTransaction();
    await expect(page.locator('#out')).toContainText(/^"0x/, { timeout: 30_000 });

    // 6. toggleShowTestNetworks: a fresh 13.x profile ships no test-chain
    // network, so the toggle is absent and the method fails with a clear,
    // actionable error (full enable-path validation needs a configured
    // testnet, which is environment-specific).
    await expect(realWallet.toggleShowTestNetworks(true)).rejects.toThrow(
      /Show test networks/i,
    );
  });
});

// A separate cached profile (the customize key joins the cache key): the
// regression trap for 13.x's debounced IndexedDB persistence — the imported
// account must survive the builder closing and a relaunch from a clone.
test.describe('real MetaMask profile customization', () => {
  test.skip(!SMOKE, 'Set WEB3_TESTER_REAL_WALLET_SMOKE=true to run the real-extension smoke suite.');
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.use({
    realWalletOptions: {
      setup: { seedPhrase: TEST_SEED },
      profileSetup: {
        key: 'smoke-customize-v3',
        run: async (session) => {
          // Import a key (validates import during build) and add a named
          // account whose survival we verify by name on relaunch.
          await session.importWalletFromPrivateKey(IMPORT_KEY);
          await session.addNewAccount('Persisted');
        },
      },
    },
  });

  // Pending live dual-version selector stabilization (see docs/ROADMAP.md).
  test.fixme('customize-hook mutations survive profile close and clone', async ({ realWallet }) => {
    // If the build's mutations survived the builder closing (the 13.x
    // IndexedDB debounce trap), the named account is still selectable in a
    // fresh clone — switching by name works across both UI generations.
    await realWallet.switchAccount('Persisted');
    expect(await realWallet.getAccountAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

declare global {
  interface Window {
    connect: () => Promise<void>;
    sign: (account: string) => Promise<void>;
    send: (account: string) => Promise<void>;
    watchAsset: (address: string) => Promise<void>;
  }
}
