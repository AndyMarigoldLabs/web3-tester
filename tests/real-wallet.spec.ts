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
