import { expect, test } from '@playwright/test';
import { parseEther } from 'viem';
import { AnvilInstance, ChainController } from '../src/anvil.js';
import { MockWalletController } from '../src/mock-wallet-controller.js';

// Band 19700 + w*20 with sub-offsets 13..19 — distinct mod-20 from
// anvil.spec.ts (0..3) and private-key-rpc-client.spec.ts (10..12).
const basePort = (workerIndex: number) => 19700 + workerIndex * 20;

// Anvil dev account #0 — funded on every instance (shared default mnemonic).
const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
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

let anvilA: AnvilInstance; // chain 31337 — the wallet's default chain
let anvilB: AnvilInstance; // chain 84532 — the extra chain
let chainA: ChainController;
let chainB: ChainController;

test.beforeAll(async ({}, testInfo) => {
  const port = basePort(testInfo.workerIndex);
  [anvilA, anvilB] = await Promise.all([
    AnvilInstance.start({ port: port + 13, chainId: 31337, silent: true }),
    AnvilInstance.start({ port: port + 14, chainId: 84532, silent: true }),
  ]);
  chainA = new ChainController({ rpcUrl: anvilA.rpcUrl, chainId: 31337 });
  chainB = new ChainController({ rpcUrl: anvilB.rpcUrl, chainId: 84532 });
});

test.afterAll(async () => {
  await Promise.all([anvilA?.stop(), anvilB?.stop()]);
});

const makeWallet = async (
  page: import('@playwright/test').Page,
  options: Partial<ConstructorParameters<typeof MockWalletController>[2]> = {},
) => {
  const wallet = new MockWalletController(page, chainA, {
    accounts: [ACCOUNT],
    chainId: 31337,
    ...options,
  });
  await wallet.injectMockProvider();
  await page.setContent('<main>multichain</main>');
  return wallet;
};

test('forwarded reads route to the active chain after a dapp switch', async ({ page }) => {
  await makeWallet(page, { chains: { 84532: chainB } });
  await chainA.setBalance(ACCOUNT, parseEther('3'));
  await chainB.setBalance(ACCOUNT, parseEther('7'));

  const before = await requestFromPage(page, 'eth_getBalance', [ACCOUNT, 'latest']);
  expect(BigInt(before.ok ? (before.result as string) : '0')).toBe(parseEther('3'));

  const switched = await requestFromPage(page, 'wallet_switchEthereumChain', [
    { chainId: '0x14a34' },
  ]);
  expect(switched.ok).toBe(true);

  const after = await requestFromPage(page, 'eth_getBalance', [ACCOUNT, 'latest']);
  expect(BigInt(after.ok ? (after.result as string) : '0')).toBe(parseEther('7'));
});

test('the full wagmi flow: switch -> 4902 -> add (trusted rpcUrls) -> routed', async ({ page }) => {
  await makeWallet(page, { trustDappRpcUrls: true });

  const unknown = await requestFromPage(page, 'wallet_switchEthereumChain', [
    { chainId: '0x14a34' },
  ]);
  expect((unknown as { error: ProviderErrorShape }).error.code).toBe(4902);

  const added = await requestFromPage(page, 'wallet_addEthereumChain', [
    { chainId: '0x14a34', chainName: 'Base Sepolia (local)', rpcUrls: [anvilB.rpcUrl] },
  ]);
  expect(added).toEqual({ ok: true, result: null });

  // wagmi verifies the wallet actually switched after the add.
  expect(await requestFromPage(page, 'eth_chainId')).toEqual({ ok: true, result: '0x14a34' });

  await chainB.setBalance(ACCOUNT, parseEther('5'));
  const balance = await requestFromPage(page, 'eth_getBalance', [ACCOUNT, 'latest']);
  expect(BigInt(balance.ok ? (balance.result as string) : '0')).toBe(parseEther('5'));
});

test('trustDappRpcUrls probes the URL: chain-id mismatch rejects and leaves state untouched', async ({ page }) => {
  const wallet = await makeWallet(page, { trustDappRpcUrls: true });

  // anvilB reports 84532, but the dapp claims the URL serves chain 999.
  const mismatched = await requestFromPage(page, 'wallet_addEthereumChain', [
    { chainId: '0x3e7', rpcUrls: [anvilB.rpcUrl] },
  ]);
  expect(mismatched.ok).toBe(false);
  expect((mismatched as { error: ProviderErrorShape }).error.code).toBe(-32602);
  expect((mismatched as { error: ProviderErrorShape }).error.message).toContain('reports chain id');

  // No partial registration: the chain is still unknown and the wallet did not switch.
  expect(wallet.currentChainId).toBe('0x7a69');
  const stillUnknown = await requestFromPage(page, 'wallet_switchEthereumChain', [
    { chainId: '0x3e7' },
  ]);
  expect((stillUnknown as { error: ProviderErrorShape }).error.code).toBe(4902);
});

test('trustDappRpcUrls refuses non-http(s) rpcUrls', async ({ page }) => {
  await makeWallet(page, { trustDappRpcUrls: true });

  const rejected = await requestFromPage(page, 'wallet_addEthereumChain', [
    { chainId: '0x14a34', rpcUrls: ['ftp://198.51.100.1/rpc'] },
  ]);
  expect(rejected.ok).toBe(false);
  expect((rejected as { error: ProviderErrorShape }).error.message).toContain('http(s)');
});

test('without trustDappRpcUrls a dapp-added chain is known but unbacked (4901 on forwards)', async ({ page }) => {
  await makeWallet(page);

  const added = await requestFromPage(page, 'wallet_addEthereumChain', [
    { chainId: '0x14a34', rpcUrls: [anvilB.rpcUrl] },
  ]);
  expect(added.ok).toBe(true);
  expect(await requestFromPage(page, 'eth_chainId')).toEqual({ ok: true, result: '0x14a34' });

  const blocked = await requestFromPage(page, 'eth_blockNumber');
  expect((blocked as { error: ProviderErrorShape }).error.code).toBe(4901);
  expect((blocked as { error: ProviderErrorShape }).error.message).toContain('addChain');
});

test('addChain accepts an RPC URL string (httpRpcClient adapter) and hex aliases canonicalize', async ({ page }) => {
  const wallet = await makeWallet(page);

  // Non-canonical hex with a URL backend: both collapse to '0x14a34'.
  wallet.addChain('0x014A34', anvilB.rpcUrl);
  expect(wallet.backedChainIds).toContain('0x14a34');

  const switched = await requestFromPage(page, 'wallet_switchEthereumChain', [
    { chainId: '0x14A34' },
  ]);
  expect(switched.ok).toBe(true);
  expect(wallet.currentChainId).toBe('0x14a34');

  const blockNumber = await requestFromPage(page, 'eth_blockNumber');
  expect(blockNumber.ok).toBe(true);
});

test('transactions record the chain they executed on, with receipts only on that node', async ({ page }) => {
  const wallet = await makeWallet(page, { chains: { 84532: chainB } });

  const first = await requestFromPage(page, 'eth_sendTransaction', [
    { to: RECIPIENT, value: `0x${parseEther('0.1').toString(16)}` },
  ]);
  expect(first.ok).toBe(true);

  await requestFromPage(page, 'wallet_switchEthereumChain', [{ chainId: '0x14a34' }]);
  const second = await requestFromPage(page, 'eth_sendTransaction', [
    { to: RECIPIENT, value: `0x${parseEther('0.2').toString(16)}` },
  ]);
  expect(second.ok).toBe(true);

  expect(wallet.sentTransactionRequests.map((record) => record.chainId)).toEqual([
    '0x7a69',
    '0x14a34',
  ]);

  const [hashA, hashB] = wallet.sentTransactions;
  expect(await chainA.client.getTransactionReceipt({ hash: hashA! })).toBeTruthy();
  expect(await chainB.client.getTransactionReceipt({ hash: hashB! })).toBeTruthy();
  await expect(chainB.client.getTransactionReceipt({ hash: hashA! })).rejects.toThrow();
});

test('deny-mode wagmi sequence needs exactly one arm: the add (4902 needs none)', async ({ page }) => {
  const wallet = await makeWallet(page, { autoApprove: false, trustDappRpcUrls: true });

  const unknown = await requestFromPage(page, 'wallet_switchEthereumChain', [
    { chainId: '0x14a34' },
  ]);
  expect((unknown as { error: ProviderErrorShape }).error.code).toBe(4902);

  wallet.approveNext('wallet_addEthereumChain');
  const added = await requestFromPage(page, 'wallet_addEthereumChain', [
    { chainId: '0x14a34', rpcUrls: [anvilB.rpcUrl] },
  ]);
  expect(added.ok).toBe(true);
  expect(wallet.currentChainId).toBe('0x14a34');
});

test('listing the default chainId in chains is a construction error', async ({ page }) => {
  expect(
    () =>
      new MockWalletController(page, chainA, {
        accounts: [ACCOUNT],
        chainId: 31337,
        chains: { '0x7a69': chainB },
      }),
  ).toThrow(/must not list the default chainId/);
});
