import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_WALLET_PASSWORD, passwordForSetup } from '../src/real-wallet-setup.js';
import { resolveRealWalletProfile } from '../src/real-wallet.js';

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
