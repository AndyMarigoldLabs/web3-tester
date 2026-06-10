import { privateKeyToAccount } from 'viem/accounts';
import { expect, test } from '../src/fixtures.js';

// Anvil dev key #1 — derived from the default mnemonic, hermetic.
const AUTHORITY_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const DELEGATE = '0x00000000000000000000000000000000000de1e6' as const;

test('delegate / getDelegation / revokeDelegation round-trip', async ({ chain }) => {
  const authority = privateKeyToAccount(AUTHORITY_KEY);
  expect(await chain.getDelegation(authority.address)).toBeNull();

  const { hash } = await chain.delegate({ account: authority, contractAddress: DELEGATE });
  const receipt = await chain.client.getTransactionReceipt({ hash });
  expect(receipt.type).toBe('eip7702');
  expect(receipt.status).toBe('success');
  expect((await chain.getDelegation(authority.address))?.toLowerCase()).toBe(DELEGATE);

  await chain.revokeDelegation({ account: authority });
  expect(await chain.getDelegation(authority.address)).toBeNull();
});

test('delegate accepts a raw private key and a self-executing authority', async ({ chain }) => {
  const authority = privateKeyToAccount(AUTHORITY_KEY);

  // sponsor === authority: viem signs the authorization with nonce+1
  // (executor: 'self'), and the authority — an unlocked anvil account —
  // submits its own type-4 transaction.
  await chain.delegate({
    account: AUTHORITY_KEY,
    contractAddress: DELEGATE,
    sponsor: authority.address,
  });
  expect((await chain.getDelegation(authority.address))?.toLowerCase()).toBe(DELEGATE);

  await chain.revokeDelegation({ account: AUTHORITY_KEY, sponsor: authority.address });
  expect(await chain.getDelegation(authority.address)).toBeNull();
});

test('signAuthorization returns a verifiable signed authorization', async ({ chain }) => {
  const authorization = await chain.signAuthorization({
    account: AUTHORITY_KEY,
    contractAddress: DELEGATE,
  });
  expect(authorization.address.toLowerCase()).toBe(DELEGATE);
  expect(authorization.chainId).toBe(chain.chainId);
  expect(typeof authorization.nonce).toBe('number');
  expect(authorization.r).toMatch(/^0x/);
  expect(authorization.s).toMatch(/^0x/);
});
