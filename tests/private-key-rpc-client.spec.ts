import { expect, test } from '@playwright/test';
import { recoverMessageAddress, stringToHex, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PrivateKeyRpcClient } from '../src/private-key-rpc-client.js';

// Well-known anvil dev key #0 — never holds real funds.
const PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const account = privateKeyToAccount(PRIVATE_KEY);

const client = () => new PrivateKeyRpcClient({ privateKey: PRIVATE_KEY, chain: sepolia });

test.describe('personal_sign', () => {
  test('signs hex-encoded UTF-8 text identically to signing the text', async () => {
    const text = 'hello web3-tester';
    const viaHex = (await client().request({
      method: 'personal_sign',
      params: [stringToHex(text), account.address],
    })) as `0x${string}`;
    const direct = await account.signMessage({ message: text });

    expect(viaHex).toBe(direct);
  });

  test('signs non-UTF-8 binary payloads as raw bytes (regression: lossy UTF-8 decode)', async () => {
    // 0xff opens an invalid UTF-8 sequence; the old hexToString path replaced
    // it with U+FFFD and signed corrupted bytes.
    const payload = '0xff0102030405c0ffee' as const;
    const signature = (await client().request({
      method: 'personal_sign',
      params: [payload, account.address],
    })) as `0x${string}`;

    const recovered = await recoverMessageAddress({
      message: { raw: payload },
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  test('accepts standard [message, address] order', async () => {
    const signature = (await client().request({
      method: 'personal_sign',
      params: [stringToHex('standard order'), account.address],
    })) as `0x${string}`;

    const recovered = await recoverMessageAddress({
      message: 'standard order',
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  test('accepts legacy [address, message] order', async () => {
    const signature = (await client().request({
      method: 'personal_sign',
      params: [account.address, stringToHex('legacy order')],
    })) as `0x${string}`;

    const recovered = await recoverMessageAddress({
      message: 'legacy order',
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  test('treats the first param as the message when both params are addresses', async () => {
    const messageAddress = '0x0000000000000000000000000000000000000001' as const;
    const signature = (await client().request({
      method: 'personal_sign',
      params: [messageAddress, account.address],
    })) as `0x${string}`;

    const recovered = await recoverMessageAddress({
      message: { raw: messageAddress },
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

test.describe('typed data', () => {
  const typedData = {
    domain: {
      name: 'Web3 Tester',
      version: '1',
      chainId: sepolia.id,
      verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
    },
    types: {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    },
    primaryType: 'Person',
    message: {
      name: 'Fjapybara',
      wallet: account.address,
    },
  } as const;

  for (const method of ['eth_signTypedData_v4', 'eth_signTypedData_v3'] as const) {
    test(`${method} signs JSON-string payloads verifiably`, async () => {
      const signature = (await client().request({
        method,
        params: [account.address, JSON.stringify(typedData)],
      })) as `0x${string}`;

      expect(
        await verifyTypedData({
          ...typedData,
          address: account.address,
          signature,
        }),
      ).toBe(true);
    });
  }

  test('eth_signTypedData_v4 accepts object payloads', async () => {
    const signature = (await client().request({
      method: 'eth_signTypedData_v4',
      params: [account.address, typedData],
    })) as `0x${string}`;

    expect(
      await verifyTypedData({
        ...typedData,
        address: account.address,
        signature,
      }),
    ).toBe(true);
  });

  test('eth_signTypedData (legacy v1) throws a clear error', async () => {
    await expect(
      client().request({ method: 'eth_signTypedData', params: [[], account.address] }),
    ).rejects.toThrow(/legacy v1.*not supported/i);
  });
});

test('eth_sendTransaction without a transaction object throws', async () => {
  await expect(
    client().request({ method: 'eth_sendTransaction', params: [] }),
  ).rejects.toThrow(/requires a transaction object/);
});
