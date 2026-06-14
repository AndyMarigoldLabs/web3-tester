import { SignClient } from '@walletconnect/sign-client';
import { recoverMessageAddress, type Hex } from 'viem';
import { benchmarkForTest } from '../src/benchmark.js';
import { expect, test } from '../src/fixtures.js';
import { WalletConnectWallet } from '../src/walletconnect.js';

// Opt-in: pairs over the real WalletConnect relay (network + project id).
// Never a CI gate — mirrors the WEB3_TESTER_REAL_WALLET_SMOKE pattern.
const PROJECT_ID = process.env.WEB3_TESTER_WC_PROJECT_ID;

test.skip(!PROJECT_ID, 'Set WEB3_TESTER_WC_PROJECT_ID to run the WalletConnect relay suite.');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test('full relay round-trip: pair, arm, sign, send, push, disconnect', async ({ chain, wallet }, testInfo) => {
  const benchmark = benchmarkForTest(testInfo, { suite: 'walletconnect-live' });
  const dapp = await benchmark.measure('walletConnect.dapp.init', () =>
    SignClient.init({
      projectId: PROJECT_ID!,
      customStoragePrefix: 'web3-tester-live-dapp',
      metadata: { name: 'web3-tester dapp', description: 'live spec', url: 'https://example.test', icons: [] },
      storageOptions: { database: ':memory:' },
    }),
  );
  const wc = await benchmark.measure('walletConnect.wallet.create', () =>
    WalletConnectWallet.create({
      wallet,
      projectId: PROJECT_ID!,
      customStoragePrefix: 'web3-tester-live-wallet',
      // Relay verify contexts for an in-process dapp are UNKNOWN-validated.
      enforceOrigins: false,
    }),
  );

  try {
    const { uri, approval } = await benchmark.measure('walletConnect.dapp.connect', () =>
      dapp.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['personal_sign', 'eth_sendTransaction'],
            chains: ['eip155:31337'],
            events: ['chainChanged', 'accountsChanged'],
          },
        },
      }),
    );
    expect(uri).toBeTruthy();

    // Deny-by-default arming governs the WC connect.
    wallet.autoApprove(false);
    wallet.approveNext('eth_requestAccounts');
    const [session, dappSession] = await benchmark.measure('walletConnect.pairAndApproval', () =>
      Promise.all([wc.pair({ uri: uri! }), approval()]),
    );
    expect(session.topic).toBe(dappSession.topic);
    expect(wc.sessions).toHaveLength(1);

    // personal_sign round-trip, armed per request.
    wallet.approveNext('personal_sign');
    const signature = (await benchmark.measure('walletConnect.personalSign.approved', () =>
      dapp.request({
        topic: dappSession.topic,
        chainId: 'eip155:31337',
        request: { method: 'personal_sign', params: ['0x68656c6c6f', wallet.primaryAccount] },
      }),
    )) as Hex;
    expect(
      (await recoverMessageAddress({ message: { raw: '0x68656c6c6f' }, signature })).toLowerCase(),
    ).toBe(wallet.primaryAccount.toLowerCase());

    // Unarmed requests are rejected with the wallet's 4001.
    await benchmark.measure('walletConnect.personalSign.rejected', async () => {
      await expect(
        dapp.request({
          topic: dappSession.topic,
          chainId: 'eip155:31337',
          request: { method: 'personal_sign', params: ['0x68656c6c6f', wallet.primaryAccount] },
        }),
      ).rejects.toMatchObject({ code: 4001 });
    });

    // eth_sendTransaction is recorded and mined on anvil.
    wallet.approveNext('eth_sendTransaction');
    const hash = (await benchmark.measure('walletConnect.sendTransaction', () =>
      dapp.request({
        topic: dappSession.topic,
        chainId: 'eip155:31337',
        request: {
          method: 'eth_sendTransaction',
          params: [{ to: '0x000000000000000000000000000000000000beef', value: '0x1' }],
        },
      }),
    )) as Hex;
    expect(wallet.sentTransactions).toContain(hash);
    expect(await chain.client.getTransactionReceipt({ hash })).toBeTruthy();

    // Two overlapping requests must both be delivered (disableRequestQueue).
    const held = wallet.holdNextRequest('personal_sign');
    const first = benchmark.measure('walletConnect.concurrent.personalSign', () =>
      dapp.request({
        topic: dappSession.topic,
        chainId: 'eip155:31337',
        request: { method: 'personal_sign', params: ['0x01', wallet.primaryAccount] },
      }),
    );
    wallet.approveNext('eth_sendTransaction');
    const second = (await benchmark.measure('walletConnect.concurrent.sendTransaction', () =>
      dapp.request({
        topic: dappSession.topic,
        chainId: 'eip155:31337',
        request: {
          method: 'eth_sendTransaction',
          params: [{ to: '0x000000000000000000000000000000000000beef', value: '0x1' }],
        },
      }),
    )) as Hex;
    expect(second).toMatch(/^0x/);
    (await held).approve();
    expect(await first).toMatch(/^0x/);

    // Wallet-driven chainChanged reaches the dapp client.
    const eventReceived = new Promise<unknown>((resolve) => {
      dapp.on('session_event', (event) => {
        if (event.params?.event?.name === 'chainChanged') {
          resolve(event.params.event.data);
        }
      });
    });
    await benchmark.measure('walletConnect.push.chainChanged', () => wallet.switchNetwork('0xaa36a7'));
    expect(await eventReceived).toBe(11155111);

    // Wallet-initiated disconnect propagates to the dapp.
    const dappDeleted = new Promise<void>((resolve) => {
      dapp.on('session_delete', () => resolve());
    });
    await benchmark.measure('walletConnect.disconnect', () => Promise.all([wc.disconnect(), dappDeleted]));
    expect(wc.sessions).toHaveLength(0);
  } finally {
    await benchmark.measure('walletConnect.close', async () => {
      await wc.close();
      await dapp.core.relayer.transportClose().catch(() => undefined);
      dapp.core.heartbeat.stop();
    });
    await benchmark.flush();
  }
});
