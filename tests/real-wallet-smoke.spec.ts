import http from 'node:http';
import { once } from 'node:events';
import { recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AnvilInstance, ChainController } from '../src/anvil.js';
import { DEFAULT_METAMASK_VERSION, extensionManifestVersion } from '../src/metamask-extension.js';
import { expect, test } from '../src/real-wallet-fixtures.js';
import { walletGenerationForVersion } from '../src/real-wallet.js';
import type { Page } from '@playwright/test';
import type { RealWalletSession } from '../src/real-wallet.js';

/**
 * Opt-in end-to-end validation of the real MetaMask adapter against the
 * pinned extension build: downloads MetaMask, builds a cached profile from a
 * throwaway seed, adds/switches to a local Anvil network, then exercises the
 * full connect/sign/send journey plus the account, token, settings, and
 * activity surface.
 *
 * Run with: npm run smoke:real-wallet
 * (or WEB3_TESTER_REAL_WALLET_SMOKE=true npm test -- real-wallet-smoke)
 *
 * The smoke gates releases on the pinned 13.x build (see
 * docs/RELEASE_CHECKLIST.md); 12.x stays supported as an explicit
 * configuration (WEB3_TESTER_METAMASK_VERSION=12.23.1) on a best-effort
 * validation cadence.
 */
const SMOKE = process.env.WEB3_TESTER_REAL_WALLET_SMOKE === 'true';

// The headed/headless choice is mandatory for real-wallet runs; the smoke
// defaults to headed (the fully validated mode) unless the env opts in.
const HEADLESS = process.env.WEB3_TESTER_REAL_WALLET_HEADLESS === 'true';

// Resolve the generation the same way the session does: an explicit
// extension path wins (its manifest is authoritative), otherwise the version
// env (empty → pinned default, matching prepareMetaMaskExtension's `||`).
const smokeGeneration = (): '12x' | '13x' => {
  const extensionPath = process.env.WEB3_TESTER_REAL_WALLET_EXTENSION_PATH;
  if (extensionPath) {
    try {
      return walletGenerationForVersion(extensionManifestVersion(extensionPath));
    } catch {
      // Fall through to the version env if the manifest can't be read.
    }
  }
  return walletGenerationForVersion(
    process.env.WEB3_TESTER_METAMASK_VERSION || DEFAULT_METAMASK_VERSION,
  );
};
const IS_13X = smokeGeneration() === '13x';

// The well-known anvil dev mnemonic; account #0 is funded on every anvil.
const TEST_SEED = 'test test test test test test test test test test test junk';
// A random key with NO relation to the mnemonic: 13.x SRP discovery derives
// the mnemonic's accounts, so importing one of those would hit MetaMask's
// duplicate-account error.
const IMPORT_KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318' as const;
const IMPORT_KEY_ADDRESS = privateKeyToAccount(IMPORT_KEY).address;

// Serial describe groups can land on different workers; derive ports from the
// worker's parallelIndex so concurrent groups never collide on one anvil.
const ANVIL_PORT_BASE = 19400;

// Each test asserts balances on its own recipient so groups running in
// parallel workers cannot race each other's deltas.
const JOURNEY_RECIPIENT = '0x000000000000000000000000000000000000beef';
const MINING_RECIPIENT = '0x00000000000000000000000000000000000000a1';
const RESET_RECIPIENT = '0x00000000000000000000000000000000000000a2';

const DAPP_HTML = `<!DOCTYPE html>
<html><body>
<h1>web3-tester smoke dapp</h1>
<pre id="out"></pre>
<script>
  const out = (value) => { document.getElementById('out').textContent = JSON.stringify(value); };
  window.clearOut = () => { document.getElementById('out').textContent = ''; };
  window.connect = () => window.ethereum.request({ method: 'eth_requestAccounts' }).then(out, (e) => out({ error: e.code }));
  window.sign = (account) => window.ethereum
    .request({ method: 'personal_sign', params: ['0x7765623320746573746572', account] })
    .then(out, (e) => out({ error: e.code }));
  window.send = (account, to) => window.ethereum
    .request({ method: 'eth_sendTransaction', params: [{ from: account, to, value: '0xde0b6b3a7640000' }] })
    .then(out, (e) => out({ error: e.code }));
  window.watchAsset = (address) => window.ethereum
    .request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address, symbol: 'TEST', decimals: 18 } } })
    .then(out, (e) => out({ error: e.code }));
</script>
</body></html>`;

type SmokeEnv = {
  anvil: AnvilInstance;
  chain: ChainController;
  server: http.Server;
  dappUrl: string;
};

async function startSmokeEnv(anvilPort: number): Promise<SmokeEnv> {
  const anvil = await AnvilInstance.start({ port: anvilPort, chainId: 31337, silent: true });
  const chain = new ChainController({ rpcUrl: anvil.rpcUrl, chainId: anvil.chainId });

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(DAPP_HTML);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };

  return { anvil, chain, server, dappUrl: `http://127.0.0.1:${address.port}/` };
}

async function stopSmokeEnv(env: SmokeEnv | undefined) {
  env?.server.close();
  await env?.anvil.stop();
}

// Points MetaMask at the group's anvil. Every focused test gets a fresh
// profile clone, so each one re-adds the network for itself.
async function useAnvilNetwork(env: SmokeEnv, realWallet: RealWalletSession) {
  await realWallet.addNetwork({
    name: 'Anvil Local',
    rpcUrl: env.anvil.rpcUrl,
    chainId: env.anvil.chainId,
    symbol: 'ETH',
  });
  await realWallet.switchNetwork('Anvil Local', { chainId: env.anvil.chainId });
}

// Connects the dapp and funds whichever account the wallet activates: 12.x
// activates the SRP's first account; 13.x's multichain import derives several
// accounts, so tests follow whichever account actually connects.
async function connectDapp(env: SmokeEnv, page: Page, realWallet: RealWalletSession) {
  await useAnvilNetwork(env, realWallet);
  await page.goto(env.dappUrl);
  await page.evaluate(() => {
    void window.connect();
  });
  await realWallet.connectToDapp();
  await expect(page.locator('#out')).toContainText(/^\["0x[0-9a-f]{40}"\]$/);
  const [account] = JSON.parse(await page.locator('#out').innerText()) as `0x${string}`[];
  await env.chain.setBalance(account, 10n ** 20n);
  await page.evaluate(() => {
    window.clearOut();
  });
  return account;
}

test.describe('real MetaMask smoke', () => {
  test.skip(!SMOKE, 'Set WEB3_TESTER_REAL_WALLET_SMOKE=true to run the real-extension smoke suite.');
  // Generous timeout: the first run downloads MetaMask and walks onboarding.
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let env: SmokeEnv;

  test.beforeAll(async ({}, workerInfo) => {
    env = await startSmokeEnv(ANVIL_PORT_BASE + workerInfo.parallelIndex * 10);
  });

  test.afterAll(async () => {
    await stopSmokeEnv(env);
  });

  test.use({
    realWalletOptions: {
      setup: { seedPhrase: TEST_SEED },
      headless: HEADLESS,
    },
  });

  test('full journey: import, add network, connect, sign, send, reject', async ({ page, realWallet }) => {
    // 1. Wallet-side network management, dapp connection, funding.
    const account = await connectDapp(env, page, realWallet);

    // getAccountAddress returns a valid address on both UI generations. On
    // 12.x it equals the connected account; 13.x's multichain account tree
    // has no single "selected" account pre-connect, so we only assert format.
    const reported = await realWallet.getAccountAddress();
    expect(reported).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // 2. personal_sign + confirm; the signature must recover to the account.
    await page.evaluate((a) => {
      void window.sign(a);
    }, account);
    await realWallet.confirmSignature();
    await expect(page.locator('#out')).toContainText(/^"0x/);
    const signature = JSON.parse(await page.locator('#out').innerText()) as Hex;
    const recovered = await recoverMessageAddress({ message: 'web3 tester', signature });
    expect(recovered.toLowerCase()).toBe(account.toLowerCase());

    // 3. Send 1 ETH through the real confirmation flow and verify on-chain.
    const balanceBefore = await env.chain.client.getBalance({ address: JOURNEY_RECIPIENT });
    await page.evaluate(([a, to]) => {
      void window.send(a, to);
    }, [account, JOURNEY_RECIPIENT] as const);
    await realWallet.confirmTransaction();
    await expect(page.locator('#out')).toContainText(/^"0x/, { timeout: 30_000 });
    const balanceAfter = await env.chain.client.getBalance({ address: JOURNEY_RECIPIENT });
    expect(balanceAfter - balanceBefore).toBe(10n ** 18n);

    // 4. Rejection surfaces 4001 to the dapp.
    await page.evaluate(([a, to]) => {
      void window.send(a, to);
    }, [account, JOURNEY_RECIPIENT] as const);
    await realWallet.rejectTransaction();
    await expect(page.locator('#out')).toContainText('4001', { timeout: 30_000 });
  });
});

// The 0.3.0 account/token/settings/activity surface, split into focused
// tests so a failure names the exact method (the group runs serial to bound
// concurrent headed browsers. Tests are independent (each gets its own
// profile clone and per-test recipient), so they run in parallel — a flake in
// one names that test without skipping the rest. The runner caps workers at 2
// to bound concurrent headed browsers. Each worker starts its own anvil on a
// parallelIndex-derived port.
test.describe('real MetaMask account/token/settings surface', () => {
  test.skip(!SMOKE, 'Set WEB3_TESTER_REAL_WALLET_SMOKE=true to run the real-extension smoke suite.');
  test.describe.configure({ timeout: 300_000 });

  let env: SmokeEnv;

  test.beforeAll(async ({}, workerInfo) => {
    env = await startSmokeEnv(ANVIL_PORT_BASE + workerInfo.parallelIndex * 10);
  });

  test.afterAll(async () => {
    await stopSmokeEnv(env);
  });

  test.use({
    realWalletOptions: {
      setup: { seedPhrase: TEST_SEED },
      headless: HEADLESS,
    },
  });

  // The account-management surface against the well-known anvil seed on
  // 13.34.1 is hard-won: that seed derives ~700 accounts (real mainnet
  // history), the picker is virtualized, LavaMoat blocks bulk text reads, and
  // account creation is a background dispatch the account-tree sync silently
  // drops ~1/3 of the time. The driver settles the tree, gates on a
  // non-syncing button, retries across navigations, and detects the new
  // account by its exact testid (wallet max index + 1); switch/rename narrow
  // the picker via its search box and match the exact display name.
  test('addNewAccount without a name succeeds', async ({ realWallet }) => {
    await realWallet.addNewAccount();
    expect(await realWallet.getAccountAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test('lock and unlock round-trip', async ({ realWallet }) => {
    await realWallet.lock();
    await realWallet.unlock();
    expect(await realWallet.getAccountAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test('importToken lists a deployed ERC-20', async ({ realWallet }) => {
    test.skip(
      !IS_13X,
      "12.x's token-import modal metadata-load is unreliable (Next intermittently stays disabled); " +
        'importToken is best-effort on 12.x.',
    );
    // The active network must be the anvil so MetaMask can read the contract.
    // Pass symbol/decimals explicitly so the import does not depend on
    // MetaMask's RPC metadata read (slower/flakier under load). importToken
    // resolves only after MetaMask confirms the add (the success toast / form
    // unmount), so a dialog that closes without importing fails inside the call.
    await useAnvilNetwork(env, realWallet);
    const token = await env.chain.deployErc20({ symbol: 'TEST', initialSupply: 10n ** 18n });
    await realWallet.importToken({ address: token.address, symbol: 'TEST', decimals: 18 });
  });

  test('confirmTransactionAndWaitForMining confirms and reads the hash', async ({ page, realWallet }) => {
    const account = await connectDapp(env, page, realWallet);

    const balanceBefore = await env.chain.client.getBalance({ address: MINING_RECIPIENT });
    await page.evaluate(([a, to]) => {
      void window.send(a, to);
    }, [account, MINING_RECIPIENT] as const);
    const { txHash } = await realWallet.confirmTransactionAndWaitForMining();
    const balanceAfter = await env.chain.client.getBalance({ address: MINING_RECIPIENT });
    expect(balanceAfter - balanceBefore).toBe(10n ** 18n);
    if (txHash) {
      const receipt = await env.chain.client.getTransactionReceipt({ hash: txHash });
      expect(receipt.status).toBe('success');
    }
  });

  test('approveAddToken and rejectAddToken answer wallet_watchAsset', async ({ page, realWallet }) => {
    await connectDapp(env, page, realWallet);
    // A real ERC-20 so MetaMask can read symbol/decimals over the active RPC.
    const token = await env.chain.deployErc20({ symbol: 'TEST', initialSupply: 10n ** 18n });

    await page.evaluate((address) => {
      void window.watchAsset(address);
    }, token.address);
    await realWallet.approveAddToken();
    await expect(page.locator('#out')).toContainText('true', { timeout: 30_000 });

    await page.evaluate(() => {
      window.clearOut();
    });
    await page.evaluate((address) => {
      void window.watchAsset(address);
    }, token.address);
    await realWallet.rejectAddToken();
    await expect(page.locator('#out')).toContainText('4001', { timeout: 30_000 });
  });

  test('resetAccount clears activity and a follow-up send works', async ({ page, realWallet }) => {
    const account = await connectDapp(env, page, realWallet);

    await page.evaluate(([a, to]) => {
      void window.send(a, to);
    }, [account, RESET_RECIPIENT] as const);
    await realWallet.confirmTransaction();
    await expect(page.locator('#out')).toContainText(/^"0x/, { timeout: 30_000 });

    await realWallet.resetAccount();

    await page.evaluate(() => {
      window.clearOut();
    });
    await page.evaluate(([a, to]) => {
      void window.send(a, to);
    }, [account, RESET_RECIPIENT] as const);
    await realWallet.confirmTransaction();
    await expect(page.locator('#out')).toContainText(/^"0x/, { timeout: 30_000 });
  });

  test('toggleShowTestNetworks reveals a built-in testnet (13.x)', async ({ realWallet }) => {
    test.skip(!IS_13X, 'The 13.x enable path drives the standalone #/networks page.');
    // 13.34.1 hosts the toggle on the standalone networks page (not the
    // network picker). Enabling it surfaces the built-in testnets; Sepolia
    // (eip155:11155111) then becomes selectable — no custom RPC needed.
    await realWallet.toggleShowTestNetworks(true);
    await realWallet.switchNetwork('Sepolia', { chainId: 11155111 });
  });

  test('addNewAccount with a name creates a switchable, renamable account', async ({ realWallet }) => {
    await realWallet.addNewAccount('Treasury');
    await realWallet.switchAccount('Treasury');
    await realWallet.renameAccount('Treasury', 'Vault');
    await realWallet.switchAccount('Vault');
    expect(await realWallet.getAccountAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test('importWalletFromPrivateKey adds a selectable imported account', async ({ realWallet }) => {
    // The method throws on any MetaMask import error (bad key, duplicate). The
    // imported "Imported" keyring account is then selectable by its address
    // (the picker is searched; the imported cell's testid is derived from the
    // address), and its address reads back exactly.
    await realWallet.importWalletFromPrivateKey(IMPORT_KEY);
    // 13.x: select the imported account via its address-derived keyring cell
    // (switch-by-address is best-effort on 12.x, which instead leaves the
    // freshly imported account active).
    if (IS_13X) await realWallet.switchAccount(IMPORT_KEY_ADDRESS);
    expect((await realWallet.getAccountAddress()).toLowerCase()).toBe(IMPORT_KEY_ADDRESS.toLowerCase());
  });
});

// A separate cached profile (the customize key joins the cache key): a
// regression trap for 13.x's debounced IndexedDB persistence — the build-time
// private-key import must survive the builder closing and a relaunch from a
// clone. The mutation is a custom network add — a clean core-state write that
// flushes reliably (unlike a private-key import, whose encrypted keyring lands
// in a delayed, variably-timed second wave, or an account rename, whose name
// write can lag; both are best-effort in customize hooks). A fresh clone can
// still switch to the network if it survived the debounced flush.
test.describe('real MetaMask profile customization', () => {
  test.skip(!SMOKE, 'Set WEB3_TESTER_REAL_WALLET_SMOKE=true to run the real-extension smoke suite.');
  test.describe.configure({ timeout: 300_000 });

  test.use({
    realWalletOptions: {
      setup: { seedPhrase: TEST_SEED },
      headless: HEADLESS,
      profileSetup: {
        key: 'smoke-customize-v9',
        run: async (session) => {
          // A short-lived anvil so MetaMask can validate the chain id while
          // the network is added; the config persists after it stops.
          const anvil = await AnvilInstance.start({ port: 19700, chainId: 31337, silent: true });
          try {
            await session.addNetwork({
              name: 'Persisted Net',
              rpcUrl: anvil.rpcUrl,
              chainId: 31337,
              symbol: 'ETH',
            });
          } finally {
            await anvil.stop();
          }
        },
      },
    },
  });

  test('customize-hook mutation survives profile close and clone', async ({ realWallet }) => {
    // If the build's custom network survived the 13.x debounced IndexedDB
    // flush, a fresh clone can still select it.
    await realWallet.switchNetwork('Persisted Net', { chainId: 31337 });
  });
});

declare global {
  interface Window {
    connect: () => Promise<void>;
    sign: (account: string) => Promise<void>;
    send: (account: string, to: string) => Promise<void>;
    watchAsset: (address: string) => Promise<void>;
    addChain: (chain: {
      chainId: string;
      chainName: string;
      rpcUrls: string[];
      nativeCurrency: { name: string; symbol: string; decimals: number };
    }) => Promise<void>;
    clearOut: () => void;
  }
}
