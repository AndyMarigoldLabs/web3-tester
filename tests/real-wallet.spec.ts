import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
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
