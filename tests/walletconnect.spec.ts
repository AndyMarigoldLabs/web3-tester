import { buildApprovedNamespaces } from '@walletconnect/utils';
import { recoverMessageAddress, type Hex } from 'viem';
import { expect, test } from '../src/fixtures.js';
import {
  createSessionRequestHandler,
  getWalletConnectUri,
  WalletConnectWallet,
  __setWalletConnectModuleLoader,
  type SessionRequestEvent,
  type SessionRequestResponse,
} from '../src/walletconnect.js';

const RECIPIENT = '0x000000000000000000000000000000000000beef' as const;

const makeResponder = () => {
  const responses: SessionRequestResponse[] = [];
  return {
    responses,
    respond: async (_topic: string, response: SessionRequestResponse) => {
      responses.push(response);
    },
  };
};

const requestEvent = (
  id: number,
  method: string,
  params: unknown,
  overrides: Partial<SessionRequestEvent> = {},
): SessionRequestEvent => ({
  id,
  topic: 'test-topic',
  params: { request: { method, params }, chainId: 'eip155:31337' },
  ...overrides,
});

test.describe('session_request gating parity', () => {
  test('signing, recording, holds, and rejections behave exactly like injected traffic', async ({
    chain,
    wallet,
  }) => {
    const { responses, respond } = makeResponder();
    const handle = createSessionRequestHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: false },
      respond,
    );

    // Auto-approved personal_sign produces a recoverable signature.
    await handle(requestEvent(1, 'personal_sign', ['0x68656c6c6f', wallet.primaryAccount]));
    const signature = responses[0]?.result as Hex;
    expect(
      (
        await recoverMessageAddress({ message: { raw: '0x68656c6c6f' }, signature })
      ).toLowerCase(),
    ).toBe(wallet.primaryAccount.toLowerCase());

    // eth_sendTransaction lands in the wallet's transaction records and mines.
    await handle(requestEvent(2, 'eth_sendTransaction', [{ to: RECIPIENT, value: '0x1' }]));
    const hash = responses[1]?.result as Hex;
    expect(wallet.sentTransactions).toContain(hash);
    expect(await chain.client.getTransactionReceipt({ hash })).toBeTruthy();

    // Deny-by-default + arming.
    wallet.autoApprove(false);
    await handle(requestEvent(3, 'personal_sign', ['0x68656c6c6f', wallet.primaryAccount]));
    expect(responses[2]?.error).toMatchObject({ code: 4001 });

    wallet.approveNext('personal_sign');
    await handle(requestEvent(4, 'personal_sign', ['0x68656c6c6f', wallet.primaryAccount]));
    expect(responses[3]?.result).toMatch(/^0x/);

    // A held request parks the WC response until the test decides.
    const held = wallet.holdNextRequest('personal_sign');
    const pending = handle(requestEvent(5, 'personal_sign', ['0x68656c6c6f', wallet.primaryAccount]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(responses).toHaveLength(4);
    (await held).approve();
    await pending;
    expect(responses[4]?.result).toMatch(/^0x/);

    // simulateRejection's message crosses the relay verbatim.
    wallet.autoApprove(true);
    await wallet.simulateRejection('personal_sign', 'Nope.');
    await handle(requestEvent(6, 'personal_sign', ['0x68656c6c6f', wallet.primaryAccount]));
    expect(responses[5]?.error).toMatchObject({ code: 4001, message: 'Nope.' });
  });

  test('chain semantics: off-namespace 5100, approved-chain switch, wallet errors verbatim', async ({
    wallet,
  }) => {
    const { responses, respond } = makeResponder();
    const handle = createSessionRequestHandler(
      wallet,
      { chains: ['0x7a69', '0xaa36a7'], enforceOrigins: false },
      respond,
    );

    await handle(requestEvent(1, 'eth_chainId', [], {
      params: { request: { method: 'eth_chainId', params: [] }, chainId: 'eip155:1' },
    }));
    expect(responses[0]?.error).toMatchObject({ code: 5100 });

    // Approved-but-not-current chain: switch-then-dispatch (single-active-
    // chain semantics) — eth_chainId answers for the requested chain.
    await handle(requestEvent(2, 'eth_chainId', [], {
      params: { request: { method: 'eth_chainId', params: [] }, chainId: 'eip155:11155111' },
    }));
    expect(responses[1]?.result).toBe('0xaa36a7');
    expect(wallet.currentChainId).toBe('0xaa36a7');

    await wallet.switchNetwork('0x7a69');
    await handle(requestEvent(3, 'wallet_switchEthereumChain', [{ chainId: '0x539' }]));
    expect(responses[2]?.error).toMatchObject({ code: 4902 });
  });

  test('proposal gating: approveNext match callbacks see the proposal payload', async ({ wallet }) => {
    wallet.autoApprove(false);

    await expect(
      wallet.handleExternalRequest({
        method: 'eth_requestAccounts',
        params: [{ proposer: { name: 'Test Dapp' } }],
      }),
    ).rejects.toMatchObject({ code: 4001 });

    wallet.approveNext(
      'eth_requestAccounts',
      (_method, params) =>
        (params[0] as { proposer?: { name?: string } }).proposer?.name === 'Test Dapp',
    );
    const accounts = await wallet.handleExternalRequest({
      method: 'eth_requestAccounts',
      params: [{ proposer: { name: 'Test Dapp' } }],
    });
    expect(accounts).toEqual([wallet.primaryAccount]);
  });
});

test.describe('origin enforcement over WC', () => {
  test.use({ walletOptions: { allowedOrigins: ['https://dapp.test'] } });

  test('verifyContext origins are checked, with the documented opt-out', async ({ wallet }) => {
    const { responses, respond } = makeResponder();
    const params = ['0x68656c6c6f', wallet.primaryAccount];

    const enforcing = createSessionRequestHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: true },
      respond,
    );
    await enforcing(requestEvent(1, 'personal_sign', params, {
      verifyContext: { verified: { origin: 'https://evil.test' } },
    }));
    expect(responses[0]?.error).toMatchObject({ code: 4100 });

    await enforcing(requestEvent(2, 'personal_sign', params)); // no origin at all
    expect(responses[1]?.error).toMatchObject({ code: 4100 });

    await enforcing(requestEvent(3, 'personal_sign', params, {
      verifyContext: { verified: { origin: 'https://dapp.test' } },
    }));
    expect(responses[2]?.result).toMatch(/^0x/);

    const bypassing = createSessionRequestHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: false },
      respond,
    );
    await bypassing(requestEvent(4, 'personal_sign', params, {
      verifyContext: { verified: { origin: 'https://evil.test' } },
    }));
    expect(responses[3]?.result).toMatch(/^0x/);
  });
});

test.describe('URI extraction', () => {
  test('reads the wui-qr-code uri attribute through the shadow DOM, polling until set', async ({
    page,
    wallet,
  }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await page.setContent(`
      <script>
        class WuiQr extends HTMLElement {
          connectedCallback() {
            this.attachShadow({ mode: 'open' });
            // The attribute appears late, like a real modal opening.
            setTimeout(() => this.setAttribute('uri', 'wc:test-topic@2?relay-protocol=irn&symKey=abc'), 300);
          }
        }
        customElements.define('wui-qr-code', WuiQr);
      </script>
      <wui-qr-code data-testid="wui-qr-code"></wui-qr-code>
    `);

    const uri = await getWalletConnectUri(page, { timeoutMs: 5_000 });
    expect(uri).toBe('wc:test-topic@2?relay-protocol=irn&symKey=abc');
  });

  test('times out with a message that names the escape hatches', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await page.setContent('<main>no modal here</main>');
    await expect(getWalletConnectUri(page, { timeoutMs: 400 })).rejects.toThrow(/getUri/);
  });
});

test('missing optional peers produce an install hint', async ({ wallet }) => {
  __setWalletConnectModuleLoader(() => Promise.reject(new Error('MODULE_NOT_FOUND')));
  try {
    await expect(WalletConnectWallet.create({ wallet, projectId: 'irrelevant' })).rejects.toThrow(
      /optional peer dependencies.*@walletconnect\/sign-client/s,
    );
  } finally {
    __setWalletConnectModuleLoader();
  }
});

test('AppKit-style optionalNamespaces proposals build a 31337-only namespace', async ({ wallet }) => {
  const namespaces = buildApprovedNamespaces({
    proposal: {
      id: 1,
      pairingTopic: 'x',
      expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
      relays: [{ protocol: 'irn' }],
      proposer: { publicKey: 'pk', metadata: { name: 'dapp', description: '', url: '', icons: [] } },
      requiredNamespaces: {},
      optionalNamespaces: {
        eip155: {
          chains: ['eip155:31337', 'eip155:1'],
          methods: ['personal_sign', 'eth_sendTransaction'],
          events: ['chainChanged', 'accountsChanged'],
        },
      },
    } as never,
    supportedNamespaces: {
      eip155: {
        chains: ['eip155:31337'],
        methods: ['personal_sign', 'eth_sendTransaction'],
        events: ['chainChanged', 'accountsChanged'],
        accounts: [`eip155:31337:${wallet.primaryAccount}`],
      },
    },
  });

  expect(namespaces.eip155?.chains).toEqual(['eip155:31337']);
  expect(namespaces.eip155?.accounts).toEqual([`eip155:31337:${wallet.primaryAccount}`]);
});
