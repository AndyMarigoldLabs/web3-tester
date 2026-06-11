import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { cloneWalletProfile } from '../src/real-wallet-cache.js';
import { DEFAULT_WALLET_PASSWORD, passwordForSetup } from '../src/real-wallet-setup.js';
import {
  resolveGenLocators,
  resolveRealWalletHeadless,
  resolveRealWalletProfile,
  walletGenerationForVersion,
} from '../src/real-wallet.js';

test('resolveRealWalletProfile accepts a dedicated persistent context directory', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web3-tester-profile-'));

  expect(resolveRealWalletProfile(userDataDir)).toEqual({ userDataDir });
});

test('resolveRealWalletProfile maps Chrome profile directories to user data root', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web3-tester-chrome-root-'));
  const profileDir = path.join(userDataDir, 'Profile 1');
  fs.mkdirSync(profileDir);
  fs.writeFileSync(path.join(userDataDir, 'Local State'), '{}');

  expect(resolveRealWalletProfile(profileDir)).toEqual({
    profileDirectory: 'Profile 1',
    userDataDir,
  });
});

test('passwordForSetup uses explicit wallet password when provided', () => {
  expect(passwordForSetup({ password: 'configured-password', seedPhrase: 'test seed phrase' })).toBe(
    'configured-password',
  );
});

test('passwordForSetup falls back to a deterministic test password for seed imports', () => {
  expect(passwordForSetup({ seedPhrase: 'test seed phrase' })).toBe(DEFAULT_WALLET_PASSWORD);
});

test('passwordForSetup leaves preconfigured profiles passwordless by default', () => {
  expect(passwordForSetup(undefined)).toBeUndefined();
  expect(passwordForSetup({})).toBeUndefined();
});

test('normalizePrivateKey accepts 32-byte hex with or without 0x and rejects garbage', async () => {
  const { normalizePrivateKey } = await import('../src/real-wallet.js');
  const bare = 'a'.repeat(64);

  expect(normalizePrivateKey(`0x${bare}`)).toBe(`0x${bare}`);
  expect(normalizePrivateKey(`  ${bare} `)).toBe(bare);
  for (const bad of ['0x1234', `0x${'g'.repeat(64)}`, '', `0x${'a'.repeat(63)}`]) {
    expect(() => normalizePrivateKey(bad), bad).toThrow(/32-byte hex private key/);
  }
});

test('isFullTxHash matches exactly 32-byte hashes', async () => {
  const { isFullTxHash } = await import('../src/real-wallet.js');
  expect(isFullTxHash(`0x${'ab'.repeat(32)}`)).toBe(true);
  expect(isFullTxHash(`0x${'ab'.repeat(20)}`)).toBe(false);
  expect(isFullTxHash(undefined)).toBe(false);
  expect(isFullTxHash('not-a-hash')).toBe(false);
});

test('accountRowMatcher matches names, full addresses, and shortened row text', async () => {
  const { accountRowMatcher } = await import('../src/real-wallet.js');
  const address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  expect(accountRowMatcher('Treasury').test('Treasury $1,234')).toBe(true);
  expect(accountRowMatcher('Treasury').test('Account 2')).toBe(false);

  const byAddress = accountRowMatcher(address);
  expect(byAddress.test(`Account 2 ${address}`)).toBe(true);
  expect(byAddress.test('Account 2 0x7099...79c8')).toBe(true);
  expect(byAddress.test('Account 2 0x1234...beef')).toBe(false);
});

const fakeLocator = (label: string) => ({ label }) as unknown as Locator;

test('resolveGenLocators keeps bare locators in order and drops the other generation', () => {
  const a = fakeLocator('a');
  const b = fakeLocator('b');
  const only12 = fakeLocator('only12');
  const only13 = fakeLocator('only13');
  const stack = [{ gen: '13x' as const, loc: only13 }, a, { gen: '12x' as const, loc: only12 }, b];

  // Bare-locator arrays pass through untouched on either generation.
  expect(resolveGenLocators([a, b], '13x')).toEqual([a, b]);
  expect(resolveGenLocators([a, b], '12x')).toEqual([a, b]);

  // Tagged entries are filtered to the active generation, order preserved.
  expect(resolveGenLocators(stack, '13x')).toEqual([only13, a, b]);
  expect(resolveGenLocators(stack, '12x')).toEqual([a, only12, b]);

  // A stack made solely of the other generation resolves to empty (the
  // callers short-circuit instead of probing).
  expect(resolveGenLocators([{ gen: '12x', loc: only12 }], '13x')).toEqual([]);
});

test('walletGenerationForVersion splits at major 13 and defaults unparseable to 13x', () => {
  expect(walletGenerationForVersion('12.23.1')).toBe('12x');
  expect(walletGenerationForVersion('13.34.1')).toBe('13x');
  expect(walletGenerationForVersion('14.0.0')).toBe('13x');
  expect(walletGenerationForVersion('not-a-version')).toBe('13x');
});

test('resolveRealWalletHeadless demands an explicit choice', () => {
  const saved = process.env.WEB3_TESTER_REAL_WALLET_HEADLESS;
  try {
    delete process.env.WEB3_TESTER_REAL_WALLET_HEADLESS;
    expect(resolveRealWalletHeadless(true)).toBe(true);
    expect(resolveRealWalletHeadless(false)).toBe(false);
    expect(() => resolveRealWalletHeadless()).toThrow(/explicit headed\/headless choice/);

    process.env.WEB3_TESTER_REAL_WALLET_HEADLESS = 'true';
    expect(resolveRealWalletHeadless()).toBe(true);
    // The per-launch option outranks the environment.
    expect(resolveRealWalletHeadless(false)).toBe(false);

    process.env.WEB3_TESTER_REAL_WALLET_HEADLESS = 'false';
    expect(resolveRealWalletHeadless()).toBe(false);

    process.env.WEB3_TESTER_REAL_WALLET_HEADLESS = 'yes';
    expect(() => resolveRealWalletHeadless()).toThrow(/must be "true" or "false"/);
  } finally {
    if (saved === undefined) delete process.env.WEB3_TESTER_REAL_WALLET_HEADLESS;
    else process.env.WEB3_TESTER_REAL_WALLET_HEADLESS = saved;
  }
});

test('cloneWalletProfile prunes regenerable caches but keeps wallet state', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web3-tester-clone-src-'));
  const write = (...segments: string[]) => {
    const file = path.join(cacheDir, ...segments);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
  };

  write('.web3-tester-profile-ready');
  write('SingletonLock');
  write('Default', 'Cache', 'data');
  write('Default', 'Service Worker', 'CacheStorage', 'data');
  write('Default', 'Code Cache', 'js', 'data');
  write('Default', 'Local Extension Settings', 'extension-id', 'vault.ldb');
  write('Default', 'IndexedDB', 'chrome-extension_id_0.indexeddb.leveldb', 'state.ldb');
  write('Default', 'Preferences');

  const targetDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web3-tester-clone-dst-')), 'profile');
  await cloneWalletProfile(cacheDir, targetDir);

  expect(fs.existsSync(path.join(targetDir, 'Default', 'Cache'))).toBe(false);
  expect(fs.existsSync(path.join(targetDir, 'Default', 'Service Worker'))).toBe(false);
  expect(fs.existsSync(path.join(targetDir, 'Default', 'Code Cache'))).toBe(false);
  expect(fs.existsSync(path.join(targetDir, 'SingletonLock'))).toBe(false);
  expect(fs.existsSync(path.join(targetDir, '.web3-tester-profile-ready'))).toBe(false);

  expect(
    fs.existsSync(path.join(targetDir, 'Default', 'Local Extension Settings', 'extension-id', 'vault.ldb')),
  ).toBe(true);
  expect(
    fs.existsSync(
      path.join(targetDir, 'Default', 'IndexedDB', 'chrome-extension_id_0.indexeddb.leveldb', 'state.ldb'),
    ),
  ).toBe(true);
  expect(fs.existsSync(path.join(targetDir, 'Default', 'Preferences'))).toBe(true);
});
