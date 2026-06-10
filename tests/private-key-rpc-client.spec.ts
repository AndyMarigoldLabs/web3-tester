import { expect, test } from '@playwright/test';
import { recoverMessageAddress, stringToHex, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, mainnet, sepolia } from 'viem/chains';
import { AnvilInstance } from '../src/anvil.js';
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

test.describe('chain guard', () => {
  // anvil.spec.ts uses 19100 + 20w + {0..3}; this band sits at offset 10-12
  // mod 20 from the same stride, so the two can never collide at any pair of
  // worker indices.
  const basePort = (workerIndex: number) => 19510 + workerIndex * 20;

  test('refuses production chains without allowMainnet', () => {
    expect(
      () => new PrivateKeyRpcClient({ privateKey: PRIVATE_KEY, chain: mainnet }),
    ).toThrow(/allowMainnet/);
  });

  test('allows production chains with allowMainnet: true', () => {
    expect(
      () =>
        new PrivateKeyRpcClient({ privateKey: PRIVATE_KEY, chain: mainnet, allowMainnet: true }),
    ).not.toThrow();
  });

  test('allows local dev chains that viem does not flag as testnets', () => {
    expect(() => new PrivateKeyRpcClient({ privateKey: PRIVATE_KEY, chain: foundry })).not.toThrow();
  });

  test('refuses to broadcast when the RPC endpoint reports a different chain', async ({}, testInfo) => {
    const anvil = await AnvilInstance.start({
      port: basePort(testInfo.workerIndex),
      chainId: 31337,
      silent: true,
    });

    try {
      const mismatched = new PrivateKeyRpcClient({
        privateKey: PRIVATE_KEY,
        chain: sepolia,
        rpcUrl: anvil.rpcUrl,
      });

      await expect(
        mismatched.request({
          method: 'eth_sendTransaction',
          params: [{ to: account.address, value: '0x1' }],
        }),
      ).rejects.toThrow(/reports chain id 31337/);
      expect(mismatched.sentTransactions).toHaveLength(0);

      // eth_sendRawTransaction is also a broadcast and must hit the same wall.
      await expect(
        mismatched.request({ method: 'eth_sendRawTransaction', params: ['0x02deadbeef'] }),
      ).rejects.toThrow(/reports chain id 31337/);

      // allowMainnet skips the construction guard, never the RPC verification.
      const mainnetAllowed = new PrivateKeyRpcClient({
        privateKey: PRIVATE_KEY,
        chain: mainnet,
        allowMainnet: true,
        rpcUrl: anvil.rpcUrl,
      });
      await expect(
        mainnetAllowed.request({
          method: 'eth_sendTransaction',
          params: [{ to: account.address, value: '0x1' }],
        }),
      ).rejects.toThrow(/reports chain id 31337/);

      // The node itself confirms nothing was broadcast.
      const nonce = (await mismatched.request({
        method: 'eth_getTransactionCount',
        params: [account.address, 'pending'],
      })) as string;
      expect(Number(BigInt(nonce))).toBe(0);
    } finally {
      await anvil.stop();
    }
  });

  test('broadcasts once the RPC chain id verifies', async ({}, testInfo) => {
    const anvil = await AnvilInstance.start({
      port: basePort(testInfo.workerIndex) + 1,
      chainId: 31337,
      silent: true,
    });

    try {
      const matched = new PrivateKeyRpcClient({
        privateKey: PRIVATE_KEY,
        chain: foundry,
        rpcUrl: anvil.rpcUrl,
      });

      const hash = (await matched.request({
        method: 'eth_sendTransaction',
        params: [{ to: account.address, value: '0x1' }],
      })) as `0x${string}`;

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(matched.sentTransactions).toEqual([hash]);
    } finally {
      await anvil.stop();
    }
  });
});
