import { buildApprovedNamespaces, buildAuthObject } from '@walletconnect/utils';
import { recoverMessageAddress, type Address, type Hex } from 'viem';
import { expect, test } from '../src/fixtures.js';
import {
  createSessionAuthenticateHandler,
  createSessionRequestHandler,
  DEFAULT_WALLETCONNECT_METHODS,
  DEFAULT_WALLETCONNECT_COINBASE_METHODS,
  getWalletConnectUri,
  WalletConnectWallet,
  __setWalletConnectModuleLoader,
  type WalletConnectCacao,
  type SessionAuthenticateEvent,
  type SessionRequestEvent,
  type SessionRequestResponse,
} from '../src/walletconnect.js';
import {
  createWalletPersona,
  formatWalletConnectUriForPersona,
  walletConnectLinksForPersona,
  walletConnectMetadataForPersona,
  walletPersonas,
} from '../src/wallet-personas.js';

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
    expect(await chain.client.waitForTransactionReceipt({ hash })).toBeTruthy();

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

  test('EIP-5792 batch methods dispatch through WalletConnect sessions', async ({
    wallet,
  }) => {
    const { responses, respond } = makeResponder();
    const handle = createSessionRequestHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: false },
      respond,
    );

    await handle(requestEvent(1, 'wallet_getCapabilities', [wallet.primaryAccount]));
    expect(responses[0]?.result).toMatchObject({
      '0x7a69': { atomic: { status: 'supported' } },
    });

    await handle(
      requestEvent(2, 'wallet_sendCalls', [
        {
          version: '2.0.0',
          chainId: wallet.currentChainId,
          atomicRequired: false,
          calls: [{ to: RECIPIENT, value: '0x1' }],
        },
      ]),
    );
    const id = (responses[1]?.result as { id?: Hex } | undefined)?.id;
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(wallet.sentCallBatches).toHaveLength(1);
    expect(wallet.sentCallBatches[0]?.id).toBe(id);

    await handle(requestEvent(3, 'wallet_getCallsStatus', [id]));
    expect(responses[2]?.result).toMatchObject({
      version: '2.0.0',
      id,
      chainId: '0x7a69',
      status: 200,
    });
  });

  test('wallet_watchAsset records through WalletConnect sessions', async ({ wallet }) => {
    const { responses, respond } = makeResponder();
    const handle = createSessionRequestHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: false },
      respond,
    );

    const pending = wallet.waitForNextWatchedAsset();
    await handle(
      requestEvent(1, 'wallet_watchAsset', {
        type: 'ERC20',
        options: { address: RECIPIENT, symbol: 'BEEF', decimals: 18 },
      }),
    );
    const watched = await pending;

    expect(responses[0]?.result).toBe(true);
    expect(watched).toMatchObject({
      chainId: '0x7a69',
      type: 'ERC20',
      options: { address: RECIPIENT, symbol: 'BEEF', decimals: 18 },
    });
  });

  test('wallet_watchAsset validation errors cross WalletConnect without consuming approval', async ({
    wallet,
  }) => {
    wallet.autoApprove(false);
    wallet.approveNext('wallet_watchAsset');
    const { responses, respond } = makeResponder();
    const handle = createSessionRequestHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: false },
      respond,
    );

    await handle(
      requestEvent(1, 'wallet_watchAsset', {
        type: 'ERC20',
        options: { address: 'not-an-address', symbol: 'BAD', decimals: 18 },
      }),
    );
    expect(responses[0]?.error).toMatchObject({
      code: -32602,
      message: 'wallet_watchAsset.options.address must be a valid address.',
    });
    expect(wallet.watchedAssets).toEqual([]);

    const pending = wallet.waitForNextWatchedAsset();
    await handle(
      requestEvent(2, 'wallet_watchAsset', {
        type: 'ERC20',
        options: { address: RECIPIENT, symbol: 'BEEF', decimals: 18 },
      }),
    );

    expect(responses[1]?.result).toBe(true);
    await expect(pending).resolves.toMatchObject({
      type: 'ERC20',
      options: { address: RECIPIENT },
    });
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

  test('Solana namespace requests use the same approval gates and response shapes', async ({
    wallet,
  }) => {
    const publicKey = '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo';
    const { responses, respond } = makeResponder();
    const handle = createSessionRequestHandler(
      wallet,
      {
        chains: ['0x7a69'],
        enforceOrigins: false,
        solana: {
          chains: ['solana:mainnet'],
          publicKey,
          methods: [
            'solana_getAccounts',
            'solana_requestAccounts',
            'solana_signIn',
            'solana_signAllTransactions',
            'solana_signAndSendAllTransactions',
            'solana_signAndSendTransaction',
            'solana_signMessage',
            'solana_signTransaction',
          ],
          events: ['accountsChanged'],
        },
      },
      respond,
    );

    await handle(requestEvent(1, 'solana_getAccounts', {}, {
      params: { request: { method: 'solana_getAccounts', params: {} }, chainId: 'solana:mainnet' },
    }));
    expect(responses[0]?.result).toEqual([{ pubkey: publicKey }]);

    await handle(requestEvent(2, 'solana_getAccounts', {}, {
      params: { request: { method: 'solana_getAccounts', params: {} }, chainId: 'solana:testnet' },
    }));
    expect(responses[1]?.error).toMatchObject({ code: 5100 });

    wallet.autoApprove(false);
    await handle(requestEvent(3, 'solana_signMessage', { message: 'mock-message', pubkey: publicKey }, {
      params: {
        request: {
          method: 'solana_signMessage',
          params: { message: 'mock-message', pubkey: publicKey },
        },
        chainId: 'solana:mainnet',
      },
    }));
    expect(responses[2]?.error).toMatchObject({ code: 4001 });

    wallet.approveNext('solana_signMessage');
    await handle(requestEvent(4, 'solana_signMessage', { message: 'mock-message', pubkey: publicKey }, {
      params: {
        request: {
          method: 'solana_signMessage',
          params: { message: 'mock-message', pubkey: publicKey },
        },
        chainId: 'solana:mainnet',
      },
    }));
    expect(responses[3]?.result).toEqual({
      signature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]+$/),
    });

    await handle(requestEvent(5, 'solana_signIn', { domain: 'app.example', nonce: 'nonce123' }, {
      params: {
        request: {
          method: 'solana_signIn',
          params: { domain: 'app.example', nonce: 'nonce123' },
        },
        chainId: 'solana:mainnet',
      },
    }));
    expect(responses[4]?.error).toMatchObject({ code: 4001 });

    wallet.approveNext('solana_signIn');
    await handle(requestEvent(6, 'solana_signIn', { domain: 'app.example', nonce: 'nonce123' }, {
      params: {
        request: {
          method: 'solana_signIn',
          params: { domain: 'app.example', nonce: 'nonce123' },
        },
        chainId: 'solana:mainnet',
      },
    }));
    const signIn = responses[5]?.result as
      | {
          address?: string;
          publicKey?: string;
          signedMessage?: number[];
          signature?: string;
          signatureType?: string;
        }
      | undefined;
    expect(signIn).toMatchObject({
      address: publicKey,
      publicKey,
      signature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]+$/),
      signatureType: 'ed25519',
    });
    expect(new TextDecoder().decode(new Uint8Array(signIn?.signedMessage ?? []))).toContain(
      'Nonce: nonce123',
    );

    wallet.approveNext('solana_signTransaction');
    await handle(requestEvent(7, 'solana_signTransaction', { transaction: 'AQID' }, {
      params: {
        request: { method: 'solana_signTransaction', params: { transaction: 'AQID' } },
        chainId: 'solana:mainnet',
      },
    }));
    expect(responses[6]?.result).toEqual({
      signature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]+$/),
      transaction: 'AQID',
    });

    wallet.approveNext('solana_signAndSendAllTransactions');
    await handle(requestEvent(8, 'solana_signAndSendAllTransactions', {
      transactions: ['AQID', 'BAUG'],
    }, {
      params: {
        request: {
          method: 'solana_signAndSendAllTransactions',
          params: { transactions: ['AQID', 'BAUG'] },
        },
        chainId: 'solana:mainnet',
      },
    }));
    expect(responses[7]?.result).toEqual({
      publicKey,
      signatures: [
        expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]+$/),
        expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]+$/),
      ],
    });

    wallet.autoApprove(true);
    await handle(requestEvent(9, 'solana_signMessage', { message: 'mock-message', pubkey: 'wrong' }, {
      params: {
        request: {
          method: 'solana_signMessage',
          params: { message: 'mock-message', pubkey: 'wrong' },
        },
        chainId: 'solana:mainnet',
      },
    }));
    expect(responses[8]?.error).toMatchObject({ code: 4100 });
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

test.describe('session_authenticate', () => {
  type TestAuthPayload = Record<string, unknown> & {
    chains: string[];
    domain: string;
    nonce: string;
    version: string;
    iat: string;
  };

  const assertTestAuthPayload = (payload: Record<string, unknown>): TestAuthPayload => {
    if (
      !Array.isArray(payload.chains) ||
      !payload.chains.every((chain) => typeof chain === 'string') ||
      typeof payload.domain !== 'string' ||
      typeof payload.nonce !== 'string' ||
      typeof payload.version !== 'string' ||
      typeof payload.iat !== 'string'
    ) {
      throw new Error('Test auth payload must include chains plus string domain, nonce, version, and iat fields.');
    }
    return payload as TestAuthPayload;
  };

  const buildTestAuthObject = (
    requestPayload: Record<string, unknown>,
    signature: { t: 'eip191' | 'eip1271'; s: string; m?: string },
    iss: string,
  ): WalletConnectCacao =>
    buildAuthObject(assertTestAuthPayload(requestPayload), signature, iss) as unknown as WalletConnectCacao;

  const authEvent = (chains: string[]): SessionAuthenticateEvent => ({
    id: 42,
    topic: 'auth-topic',
    params: {
      requester: {
        metadata: { name: 'Auth Dapp', description: '', url: 'https://auth.test', icons: [] },
      },
      authPayload: {
        chains,
        domain: 'auth.test',
        aud: 'https://auth.test/login',
        nonce: 'test-nonce',
        version: '1',
        iat: '2026-01-01T00:00:00.000Z',
        statement: 'Sign in for testing.',
      },
      expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
    },
    verifyContext: { verified: { origin: 'https://auth.test', validation: 'VALID' } },
  });

  test('approves CAIP-122 Cacaos through the same wallet approval gates', async ({ wallet }) => {
    wallet.autoApprove(false);
    wallet.approveNext('eth_requestAccounts');
    wallet.approveNext('personal_sign');

    let approvedAuths: readonly WalletConnectCacao[] | undefined;
    let rejectedReason: unknown;
    const handle = createSessionAuthenticateHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: false },
      {
        approve: async (_id, auths) => {
          approvedAuths = auths;
          return {
            session: {
              topic: 'authenticated-topic',
              namespaces: { eip155: { accounts: [`eip155:31337:${wallet.primaryAccount}`] } },
              peer: { metadata: { name: 'Auth Dapp', description: '', url: 'https://auth.test', icons: [] } },
            },
          };
        },
        buildAuthObject: buildTestAuthObject,
        formatAuthMessage: ({ request, iss }) => `${request.domain} signs ${iss} nonce ${request.nonce}`,
        getSdkError: (code) => ({ code }),
        reject: async (_id, reason) => {
          rejectedReason = reason;
        },
      },
    );

    await handle(authEvent(['eip155:31337']));

    expect(rejectedReason).toBeUndefined();
    expect(approvedAuths).toHaveLength(1);
    const [cacao] = approvedAuths ?? [];
    expect(cacao).toMatchObject({
      h: { t: 'caip122' },
      p: {
        iss: `did:pkh:eip155:31337:${wallet.primaryAccount}`,
        domain: 'auth.test',
        aud: 'https://auth.test/login',
        nonce: 'test-nonce',
      },
      s: { t: 'eip191', s: expect.stringMatching(/^0x/) },
    });
    expect(
      (
        await recoverMessageAddress({
          message: cacao?.s.m ?? '',
          signature: cacao?.s.s as Hex,
        })
      ).toLowerCase(),
    ).toBe(wallet.primaryAccount.toLowerCase());
  });

  test('rejects auth requests whose chains are outside the approved namespace', async ({
    wallet,
  }) => {
    let approved = false;
    let rejectedReason: unknown;
    const handle = createSessionAuthenticateHandler(
      wallet,
      { chains: ['0x7a69'], enforceOrigins: false },
      {
        approve: async () => {
          approved = true;
          return {};
        },
        buildAuthObject: buildTestAuthObject,
        formatAuthMessage: () => 'unused',
        getSdkError: (code) => ({ code }),
        reject: async (_id, reason) => {
          rejectedReason = reason;
        },
      },
    );

    await handle(authEvent(['eip155:1']));

    expect(approved).toBe(false);
    expect(rejectedReason).toEqual({ code: 'UNSUPPORTED_CHAINS' });
  });

  test('WalletConnectWallet subscribes to session_authenticate by default', async ({
    wallet,
  }) => {
    wallet.autoApprove(false);
    wallet.approveNext('eth_requestAccounts');
    wallet.approveNext('personal_sign');

    const handlers = new Map<string, (event: unknown) => void>();
    let approvedId: number | undefined;
    let approvedAuths: readonly WalletConnectCacao[] | undefined;
    let rejectedReason: unknown;
    const fakeClient = {
      on: (event: string, handler: (event: unknown) => void) => {
        handlers.set(event, handler);
      },
      off: (event: string) => {
        handlers.delete(event);
      },
      pair: async () => undefined,
      approve: async () => ({
        topic: 'topic',
        acknowledged: async () => undefined,
      }),
      reject: async () => undefined,
      respond: async () => undefined,
      emit: async () => undefined,
      update: async () => undefined,
      disconnect: async () => undefined,
      approveSessionAuthenticate: async ({
        id,
        auths,
      }: {
        id: number;
        auths: readonly WalletConnectCacao[];
      }) => {
        approvedId = id;
        approvedAuths = auths;
        return {
          session: {
            topic: 'authenticated-topic',
            namespaces: {
              eip155: {
                accounts: [`eip155:31337:${wallet.primaryAccount}`],
                chains: ['eip155:31337'],
                methods: ['personal_sign'],
                events: ['accountsChanged'],
              },
            },
            peer: {
              metadata: {
                name: 'Auth Dapp',
                description: '',
                url: 'https://auth.test',
                icons: [],
              },
            },
          },
        };
      },
      rejectSessionAuthenticate: async ({ reason }: { reason: unknown }) => {
        rejectedReason = reason;
      },
      formatAuthMessage: ({
        request,
        iss,
      }: {
        request: Record<string, unknown>;
        iss: string;
      }) => `${request.domain} signs ${iss} nonce ${request.nonce}`,
      core: {
        relayer: { transportClose: async () => undefined },
        heartbeat: { stop: () => undefined },
      },
    };

    __setWalletConnectModuleLoader(async (specifier) => {
      if (specifier === '@walletconnect/sign-client') {
        return { SignClient: { init: async () => fakeClient } };
      }
      if (specifier === '@walletconnect/utils') {
        return {
          parseUri: () => ({ topic: 'topic' }),
          buildApprovedNamespaces: () => ({}),
          buildAuthObject: buildTestAuthObject,
          getSdkError: (code: string) => ({ code }),
        };
      }
      throw new Error(`Unexpected module ${specifier}`);
    });

    try {
      const wc = await WalletConnectWallet.create({
        wallet,
        projectId: 'irrelevant',
        enforceOrigins: false,
      });

      expect(handlers.has('session_authenticate')).toBe(true);
      await handlers.get('session_authenticate')?.(authEvent(['eip155:31337']));

      expect(rejectedReason).toBeUndefined();
      expect(approvedId).toBe(42);
      expect(approvedAuths).toHaveLength(1);
      expect(wc.sessions).toEqual([
        expect.objectContaining({
          topic: 'authenticated-topic',
          peerMetadata: expect.objectContaining({ name: 'Auth Dapp' }),
        }),
      ]);

      await wc.close();
      expect(handlers.has('session_authenticate')).toBe(false);
    } finally {
      __setWalletConnectModuleLoader();
    }
  });

  test('WalletConnectWallet leaves session_authenticate unhandled when opted out or EVM is disabled', async ({
    wallet,
  }) => {
    const handlerSets: Array<Map<string, (event: unknown) => void>> = [];
    const fakeClient = () => {
      const handlers = new Map<string, (event: unknown) => void>();
      handlerSets.push(handlers);
      return {
        on: (event: string, handler: (event: unknown) => void) => {
          handlers.set(event, handler);
        },
        off: (event: string) => {
          handlers.delete(event);
        },
        pair: async () => undefined,
        approve: async () => ({
          topic: 'topic',
          acknowledged: async () => undefined,
        }),
        reject: async () => undefined,
        respond: async () => undefined,
        emit: async () => undefined,
        update: async () => undefined,
        disconnect: async () => undefined,
        core: {
          relayer: { transportClose: async () => undefined },
          heartbeat: { stop: () => undefined },
        },
      };
    };

    __setWalletConnectModuleLoader(async (specifier) => {
      if (specifier === '@walletconnect/sign-client') {
        return { SignClient: { init: async () => fakeClient() } };
      }
      if (specifier === '@walletconnect/utils') {
        return {
          parseUri: () => ({ topic: 'topic' }),
          buildApprovedNamespaces: () => ({}),
          buildAuthObject: buildTestAuthObject,
          getSdkError: (code: string) => ({ code }),
        };
      }
      throw new Error(`Unexpected module ${specifier}`);
    });

    try {
      const optedOut = await WalletConnectWallet.create({
        wallet,
        projectId: 'irrelevant',
        sessionAuthenticate: false,
      });
      expect(handlerSets[0]?.has('session_authenticate')).toBe(false);
      await optedOut.close();

      const solanaOnly = await WalletConnectWallet.create({
        wallet,
        projectId: 'irrelevant',
        persona: walletPersonas.solflare(),
      });
      expect(handlerSets[1]?.has('session_authenticate')).toBe(false);
      await solanaOnly.close();
    } finally {
      __setWalletConnectModuleLoader();
    }
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

  test('extracts a URI embedded in text/value modal surfaces', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await page.setContent(`
      <main>
        <pre data-testid="wc-uri">Scan this: wc:text-topic@2?relay-protocol=irn&symKey=text</pre>
        <input data-testid="wc-input" value="unused" />
      </main>
    `);

    await expect(
      getWalletConnectUri(page, {
        timeoutMs: 1_000,
        textSelectors: ['[data-testid="wc-uri"]'],
      }),
    ).resolves.toBe('wc:text-topic@2?relay-protocol=irn&symKey=text');

    await page.locator('[data-testid="wc-uri"]').evaluate((element) => element.remove());
    await page.locator('[data-testid="wc-input"]').evaluate((input) => {
      (input as HTMLInputElement).value =
        'encoded wc%3Ainput-topic%402%3Frelay-protocol%3Dirn%26symKey%3Dinput';
    });

    await expect(
      getWalletConnectUri(page, {
        timeoutMs: 1_000,
        textSelectors: ['[data-testid="wc-input"]'],
      }),
    ).resolves.toBe('wc:input-topic@2?relay-protocol=irn&symKey=input');
  });

  test('can click a copy button and read the clipboard URI', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://dapp.test',
    });
    await page.route('https://dapp.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `
          <button data-testid="copy-wc2-uri" type="button">
            Copy
          </button>
          <script>
            document.querySelector('[data-testid="copy-wc2-uri"]').addEventListener('click', () => {
              navigator.clipboard.writeText('wc:copy-topic@2?relay-protocol=irn&symKey=copy');
            });
          </script>
        `,
      }),
    );
    await page.goto('https://dapp.test/');

    await expect(
      getWalletConnectUri(page, {
        timeoutMs: 2_000,
        copyButtonSelector: '[data-testid="copy-wc2-uri"]',
      }),
    ).resolves.toBe('wc:copy-topic@2?relay-protocol=irn&symKey=copy');
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

test('persona metadata is passed to the WalletConnect SignClient', async ({ wallet }) => {
  let initOptions: Record<string, unknown> | undefined;
  const fakeClient = {
    on: () => undefined,
    pair: async () => undefined,
    approve: async () => ({
      topic: 'topic',
      acknowledged: async () => undefined,
    }),
    reject: async () => undefined,
    respond: async () => undefined,
    emit: async () => undefined,
    update: async () => undefined,
    disconnect: async () => undefined,
    core: {
      relayer: { transportClose: async () => undefined },
      heartbeat: { stop: () => undefined },
    },
  };

  __setWalletConnectModuleLoader(async (specifier) => {
    if (specifier === '@walletconnect/sign-client') {
      return {
        SignClient: {
          init: async (options: Record<string, unknown>) => {
            initOptions = options;
            return fakeClient;
          },
        },
      };
    }
    if (specifier === '@walletconnect/utils') {
      return {
        parseUri: () => ({ topic: 'topic' }),
        buildApprovedNamespaces: () => ({}),
        getSdkError: (code: string) => ({ code }),
      };
    }
    throw new Error(`Unexpected module ${specifier}`);
  });

  try {
    const wc = await WalletConnectWallet.create({
      wallet,
      projectId: 'irrelevant',
      persona: walletPersonas.phantomEvm(),
    });
    await wc.close();
  } finally {
    __setWalletConnectModuleLoader();
  }

  expect(initOptions?.metadata).toMatchObject({
    name: 'Phantom',
    description: 'Phantom EVM-compatible test wallet',
    url: 'https://phantom.com',
  });
  expect(initOptions?.metadata).not.toHaveProperty('links');
});

test('Coinbase WalletConnect persona advertises Coinbase RPC methods', async ({ wallet }) => {
  let supportedNamespaces: Record<string, unknown> | undefined;
  const handlers = new Map<string, (event: unknown) => void>();
  const fakeClient = {
    on: (event: string, handler: (event: unknown) => void) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
    pair: async () => {
      queueMicrotask(() => {
        handlers.get('session_proposal')?.({
          id: 8,
          params: {
            pairingTopic: 'topic',
            proposer: {
              metadata: { name: 'Base Dapp', description: '', url: 'https://base.test', icons: [] },
            },
            requiredNamespaces: {
              eip155: {
                chains: ['eip155:31337'],
                methods: ['wallet_connect', 'coinbase_fetchPermission'],
                events: ['accountsChanged'],
              },
            },
          },
          verifyContext: { verified: { origin: 'https://base.test', validation: 'VALID' } },
        });
      });
    },
    approve: async ({ namespaces }: { namespaces: Record<string, unknown> }) => ({
      topic: 'topic',
      acknowledged: async () => ({ namespaces }),
    }),
    reject: async () => undefined,
    respond: async () => undefined,
    emit: async () => undefined,
    update: async () => undefined,
    disconnect: async () => undefined,
    core: {
      relayer: { transportClose: async () => undefined },
      heartbeat: { stop: () => undefined },
    },
  };

  __setWalletConnectModuleLoader(async (specifier) => {
    if (specifier === '@walletconnect/sign-client') {
      return { SignClient: { init: async () => fakeClient } };
    }
    if (specifier === '@walletconnect/utils') {
      return {
        parseUri: () => ({ topic: 'topic' }),
        buildApprovedNamespaces: ({ supportedNamespaces: input }: { supportedNamespaces: Record<string, unknown> }) => {
          supportedNamespaces = input;
          return input;
        },
        getSdkError: (code: string) => ({ code }),
      };
    }
    throw new Error(`Unexpected module ${specifier}`);
  });

  try {
    const wc = await WalletConnectWallet.create({
      wallet,
      projectId: 'irrelevant',
      persona: walletPersonas.coinbase(),
    });
    await wc.pair({ uri: 'wc:topic@2?symKey=abc&relay-protocol=irn' });
    await wc.close();
  } finally {
    __setWalletConnectModuleLoader();
  }

  expect((supportedNamespaces?.eip155 as { methods?: string[] }).methods).toEqual(
    expect.arrayContaining([...DEFAULT_WALLETCONNECT_COINBASE_METHODS]),
  );
});

test('Solana-only WalletConnect personas approve Solana namespaces without eip155', async ({
  wallet,
}) => {
  wallet.autoApprove(false);
  wallet.approveNext(
    'solana_requestAccounts',
    (_method, params) =>
      (params[0] as { proposer?: { name?: string } }).proposer?.name === 'Solana Dapp',
  );

  let supportedNamespaces: Record<string, unknown> | undefined;
  let approvedNamespaces: Record<string, unknown> | undefined;
  const handlers = new Map<string, (event: unknown) => void>();
  const fakeClient = {
    on: (event: string, handler: (event: unknown) => void) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
    pair: async () => {
      queueMicrotask(() => {
        handlers.get('session_proposal')?.({
          id: 7,
          params: {
            pairingTopic: 'topic',
            proposer: {
              metadata: { name: 'Solana Dapp', description: '', url: 'https://sol.test', icons: [] },
            },
            requiredNamespaces: {},
            optionalNamespaces: {
              solana: {
                chains: ['solana:mainnet'],
                methods: ['solana_requestAccounts', 'solana_signMessage'],
                events: ['accountsChanged'],
              },
            },
          },
          verifyContext: { verified: { origin: 'https://sol.test', validation: 'VALID' } },
        });
      });
    },
    approve: async ({ namespaces }: { namespaces: Record<string, unknown> }) => {
      approvedNamespaces = namespaces;
      return {
        topic: 'session-topic',
        acknowledged: async () => ({ namespaces }),
      };
    },
    reject: async () => undefined,
    respond: async () => undefined,
    disconnect: async () => undefined,
    emit: async () => undefined,
    update: async () => undefined,
    core: {
      relayer: { transportClose: async () => undefined },
      heartbeat: { stop: () => undefined },
    },
  };

  __setWalletConnectModuleLoader(async (specifier) => {
    if (specifier === '@walletconnect/sign-client') {
      return {
        SignClient: {
          init: async () => fakeClient,
        },
      };
    }
    if (specifier === '@walletconnect/utils') {
      return {
        parseUri: () => ({ topic: 'topic' }),
        buildApprovedNamespaces: ({
          supportedNamespaces: input,
        }: {
          supportedNamespaces: Record<string, unknown>;
        }) => {
          supportedNamespaces = input;
          return { solana: input.solana };
        },
        getSdkError: (code: string) => ({ code }),
      };
    }
    throw new Error(`Unexpected module ${specifier}`);
  });

  try {
    const wc = await WalletConnectWallet.create({
      wallet,
      projectId: 'irrelevant',
      persona: walletPersonas.solflare(),
      solana: { chains: ['solana:mainnet'] },
      enforceOrigins: false,
    });
    const session = await wc.pair({ uri: 'wc:test@2?symKey=abc' });
    await wc.close();

    expect(session.namespaces).toEqual({ solana: supportedNamespaces?.solana });
  } finally {
    __setWalletConnectModuleLoader();
  }

  expect(supportedNamespaces).not.toHaveProperty('eip155');
  expect(supportedNamespaces?.solana).toMatchObject({
    chains: ['solana:mainnet'],
    methods: expect.arrayContaining([
      'solana_requestAccounts',
      'solana_signIn',
      'solana_signMessage',
    ]),
    accounts: ['solana:mainnet:9xQeWvG816bUx9EPjHmaT23yvVM2ZWkDD5DdnYwB5xP'],
  });
  expect(approvedNamespaces).toEqual({ solana: supportedNamespaces?.solana });
});

test('Solana WalletConnect sessions receive Solana accountsChanged events', async ({
  wallet,
}) => {
  const publicKey = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWkDD5DdnYwB5xP';
  const handlers = new Map<string, (event: unknown) => void>();
  const emitted: Array<{
    topic: string;
    event: { name: string; data: unknown };
    chainId: string;
  }> = [];
  const fakeClient = {
    on: (event: string, handler: (event: unknown) => void) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
    pair: async () => {
      queueMicrotask(() => {
        handlers.get('session_proposal')?.({
          id: 9,
          params: {
            pairingTopic: 'topic',
            proposer: {
              metadata: { name: 'Solana Dapp', description: '', url: 'https://sol.test', icons: [] },
            },
            requiredNamespaces: {
              solana: {
                chains: ['solana:mainnet'],
                methods: ['solana_requestAccounts'],
                events: ['accountsChanged'],
              },
            },
          },
          verifyContext: { verified: { origin: 'https://sol.test', validation: 'VALID' } },
        });
      });
    },
    approve: async ({ namespaces }: { namespaces: Record<string, unknown> }) => ({
      topic: 'session-topic',
      acknowledged: async () => ({ namespaces }),
    }),
    reject: async () => undefined,
    respond: async () => undefined,
    disconnect: async () => undefined,
    emit: async (args: {
      topic: string;
      event: { name: string; data: unknown };
      chainId: string;
    }) => {
      emitted.push(args);
    },
    update: async () => undefined,
    core: {
      relayer: { transportClose: async () => undefined },
      heartbeat: { stop: () => undefined },
    },
  };

  __setWalletConnectModuleLoader(async (specifier) => {
    if (specifier === '@walletconnect/sign-client') {
      return { SignClient: { init: async () => fakeClient } };
    }
    if (specifier === '@walletconnect/utils') {
      return {
        parseUri: () => ({ topic: 'topic' }),
        buildApprovedNamespaces: ({
          supportedNamespaces,
        }: {
          supportedNamespaces: Record<string, unknown>;
        }) => ({ solana: supportedNamespaces.solana }),
        getSdkError: (code: string) => ({ code }),
      };
    }
    throw new Error(`Unexpected module ${specifier}`);
  });

  try {
    const wc = await WalletConnectWallet.create({
      wallet,
      projectId: 'irrelevant',
      persona: walletPersonas.solflare(),
      solana: { chains: ['solana:mainnet'] },
      enforceOrigins: false,
    });
    await wc.pair({ uri: 'wc:test@2?symKey=abc' });

    await wallet.lock();
    await expect.poll(() => emitted).toEqual([
      {
        topic: 'session-topic',
        event: { name: 'accountsChanged', data: [] },
        chainId: 'solana:mainnet',
      },
    ]);

    await wallet.unlock();
    await expect.poll(() => emitted).toEqual([
      {
        topic: 'session-topic',
        event: { name: 'accountsChanged', data: [] },
        chainId: 'solana:mainnet',
      },
      {
        topic: 'session-topic',
        event: { name: 'accountsChanged', data: [publicKey] },
        chainId: 'solana:mainnet',
      },
    ]);

    await wc.close();
  } finally {
    __setWalletConnectModuleLoader();
  }
});

test('EVM WalletConnect accountsChanged refreshes namespace accounts without clearing on lock', async ({
  chain,
  wallet,
}) => {
  const [first, second] = (await chain.accounts()).slice(0, 2) as [Address, Address];
  await wallet.setAccounts([first, second]);

  const handlers = new Map<string, (event: unknown) => void>();
  const emitted: Array<{
    topic: string;
    event: { name: string; data: unknown };
    chainId: string;
  }> = [];
  const updates: Array<{ topic: string; namespaces: Record<string, unknown> }> = [];
  const fakeClient = {
    on: (event: string, handler: (event: unknown) => void) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
    pair: async () => {
      queueMicrotask(() => {
        handlers.get('session_proposal')?.({
          id: 10,
          params: {
            pairingTopic: 'topic',
            proposer: {
              metadata: { name: 'EVM Dapp', description: '', url: 'https://evm.test', icons: [] },
            },
            requiredNamespaces: {
              eip155: {
                chains: ['eip155:31337'],
                methods: ['eth_requestAccounts'],
                events: ['accountsChanged'],
              },
            },
          },
          verifyContext: { verified: { origin: 'https://evm.test', validation: 'VALID' } },
        });
      });
    },
    approve: async ({ namespaces }: { namespaces: Record<string, unknown> }) => ({
      topic: 'session-topic',
      acknowledged: async () => ({ namespaces }),
    }),
    reject: async () => undefined,
    respond: async () => undefined,
    disconnect: async () => undefined,
    emit: async (args: {
      topic: string;
      event: { name: string; data: unknown };
      chainId: string;
    }) => {
      emitted.push(args);
    },
    update: async (args: { topic: string; namespaces: Record<string, unknown> }) => {
      updates.push(args);
    },
    core: {
      relayer: { transportClose: async () => undefined },
      heartbeat: { stop: () => undefined },
    },
  };

  __setWalletConnectModuleLoader(async (specifier) => {
    if (specifier === '@walletconnect/sign-client') {
      return { SignClient: { init: async () => fakeClient } };
    }
    if (specifier === '@walletconnect/utils') {
      return {
        parseUri: () => ({ topic: 'topic' }),
        buildApprovedNamespaces: ({
          supportedNamespaces,
        }: {
          supportedNamespaces: Record<string, unknown>;
        }) => ({ eip155: supportedNamespaces.eip155 }),
        getSdkError: (code: string) => ({ code }),
      };
    }
    throw new Error(`Unexpected module ${specifier}`);
  });

  let wc: WalletConnectWallet | undefined;
  try {
    wc = await WalletConnectWallet.create({
      wallet,
      projectId: 'irrelevant',
      enforceOrigins: false,
      sessionAuthenticate: false,
    });
    const session = await wc.pair({ uri: 'wc:test@2?symKey=abc' });

    expect((session.namespaces.eip155 as { accounts?: string[] }).accounts).toEqual([
      `eip155:31337:${first}`,
      `eip155:31337:${second}`,
    ]);

    await wallet.switchAccount(second);
    await expect.poll(() => updates).toEqual([
      {
        topic: 'session-topic',
        namespaces: {
          eip155: {
            chains: ['eip155:31337'],
            methods: expect.arrayContaining(['eth_requestAccounts']),
            events: expect.arrayContaining(['accountsChanged']),
            accounts: [`eip155:31337:${second}`, `eip155:31337:${first}`],
          },
        },
      },
    ]);
    expect((wc.sessions[0]?.namespaces.eip155 as { accounts?: string[] }).accounts).toEqual([
      `eip155:31337:${second}`,
      `eip155:31337:${first}`,
    ]);
    expect(emitted[0]).toEqual({
      topic: 'session-topic',
      event: { name: 'accountsChanged', data: [second, first] },
      chainId: 'eip155:31337',
    });

    await wallet.lock();
    await expect.poll(() => emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({
      topic: 'session-topic',
      event: { name: 'accountsChanged', data: [] },
      chainId: 'eip155:31337',
    });
    expect(updates).toHaveLength(1);
  } finally {
    await wc?.close();
    __setWalletConnectModuleLoader();
  }
});

test('EVM WalletConnect chainChanged extensions approve follow-up requests on the new chain', async ({
  wallet,
}) => {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const emitted: Array<{
    topic: string;
    event: { name: string; data: unknown };
    chainId: string;
  }> = [];
  const updates: Array<{ topic: string; namespaces: Record<string, unknown> }> = [];
  const responses: Array<{ topic: string; response: SessionRequestResponse }> = [];
  const fakeClient = {
    on: (event: string, handler: (event: unknown) => unknown) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
    pair: async () => {
      queueMicrotask(() => {
        handlers.get('session_proposal')?.({
          id: 11,
          params: {
            pairingTopic: 'topic',
            proposer: {
              metadata: { name: 'EVM Dapp', description: '', url: 'https://evm.test', icons: [] },
            },
            requiredNamespaces: {
              eip155: {
                chains: ['eip155:31337'],
                methods: ['eth_chainId'],
                events: ['chainChanged'],
              },
            },
          },
          verifyContext: { verified: { origin: 'https://evm.test', validation: 'VALID' } },
        });
      });
    },
    approve: async ({ namespaces }: { namespaces: Record<string, unknown> }) => ({
      topic: 'session-topic',
      acknowledged: async () => ({ namespaces }),
    }),
    reject: async () => undefined,
    respond: async (args: { topic: string; response: SessionRequestResponse }) => {
      responses.push(args);
    },
    disconnect: async () => undefined,
    emit: async (args: {
      topic: string;
      event: { name: string; data: unknown };
      chainId: string;
    }) => {
      emitted.push(args);
    },
    update: async (args: { topic: string; namespaces: Record<string, unknown> }) => {
      updates.push(args);
    },
    core: {
      relayer: { transportClose: async () => undefined },
      heartbeat: { stop: () => undefined },
    },
  };

  __setWalletConnectModuleLoader(async (specifier) => {
    if (specifier === '@walletconnect/sign-client') {
      return { SignClient: { init: async () => fakeClient } };
    }
    if (specifier === '@walletconnect/utils') {
      return {
        parseUri: () => ({ topic: 'topic' }),
        buildApprovedNamespaces: ({
          supportedNamespaces,
        }: {
          supportedNamespaces: Record<string, unknown>;
        }) => ({ eip155: supportedNamespaces.eip155 }),
        getSdkError: (code: string) => ({ code }),
      };
    }
    throw new Error(`Unexpected module ${specifier}`);
  });

  let wc: WalletConnectWallet | undefined;
  try {
    wc = await WalletConnectWallet.create({
      wallet,
      projectId: 'irrelevant',
      enforceOrigins: false,
      sessionAuthenticate: false,
    });
    await wc.pair({ uri: 'wc:test@2?symKey=abc' });

    await wallet.switchNetwork('0xaa36a7');
    await expect.poll(() => updates).toEqual([
      {
        topic: 'session-topic',
        namespaces: {
          eip155: {
            chains: ['eip155:31337', 'eip155:11155111'],
            methods: expect.arrayContaining(['eth_chainId']),
            events: expect.arrayContaining(['chainChanged']),
            accounts: [
              `eip155:31337:${wallet.primaryAccount}`,
              `eip155:11155111:${wallet.primaryAccount}`,
            ],
          },
        },
      },
    ]);
    await expect.poll(() => emitted).toEqual([
      {
        topic: 'session-topic',
        event: { name: 'chainChanged', data: 11155111 },
        chainId: 'eip155:11155111',
      },
    ]);

    await Promise.resolve(
      handlers.get('session_request')?.({
        id: 12,
        topic: 'session-topic',
        params: {
          chainId: 'eip155:11155111',
          request: { method: 'eth_chainId', params: [] },
        },
      }),
    );

    expect(responses).toEqual([
      {
        topic: 'session-topic',
        response: { id: 12, jsonrpc: '2.0', result: '0xaa36a7' },
      },
    ]);
  } finally {
    await wc?.close();
    __setWalletConnectModuleLoader();
  }
});

test('EVM WalletConnect chainChanged extensions update every active session namespace', async ({
  wallet,
}) => {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const emitted: Array<{
    topic: string;
    event: { name: string; data: unknown };
    chainId: string;
  }> = [];
  const updates: Array<{ topic: string; namespaces: Record<string, unknown> }> = [];
  const sessionNamespaces = new Map<string, Record<string, unknown>>();
  let pairCount = 0;
  let approveCount = 0;
  const cloneNamespaces = (namespaces: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(JSON.stringify(namespaces)) as Record<string, unknown>;
  const fakeClient = {
    on: (event: string, handler: (event: unknown) => unknown) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
    pair: async () => {
      pairCount += 1;
      const pairingTopic = `topic-${pairCount}`;
      queueMicrotask(() => {
        handlers.get('session_proposal')?.({
          id: 20 + pairCount,
          params: {
            pairingTopic,
            proposer: {
              metadata: {
                name: `EVM Dapp ${pairCount}`,
                description: '',
                url: 'https://evm.test',
                icons: [],
              },
            },
            requiredNamespaces: {
              eip155: {
                chains: ['eip155:31337'],
                methods: ['eth_chainId'],
                events: ['chainChanged'],
              },
            },
          },
          verifyContext: { verified: { origin: 'https://evm.test', validation: 'VALID' } },
        });
      });
    },
    approve: async ({ namespaces }: { namespaces: Record<string, unknown> }) => {
      approveCount += 1;
      const topic = `session-topic-${approveCount}`;
      sessionNamespaces.set(topic, cloneNamespaces(namespaces));
      return {
        topic,
        acknowledged: async () => ({ namespaces }),
      };
    },
    reject: async () => undefined,
    respond: async () => undefined,
    disconnect: async () => undefined,
    emit: async (args: {
      topic: string;
      event: { name: string; data: unknown };
      chainId: string;
    }) => {
      const namespaces = sessionNamespaces.get(args.topic) as
        | { eip155?: { chains?: string[] } }
        | undefined;
      if (!namespaces?.eip155?.chains?.includes(args.chainId)) {
        throw new Error(`Session ${args.topic} has not approved ${args.chainId}.`);
      }
      emitted.push(args);
    },
    update: async (args: { topic: string; namespaces: Record<string, unknown> }) => {
      updates.push(args);
      sessionNamespaces.set(args.topic, cloneNamespaces(args.namespaces));
    },
    core: {
      relayer: { transportClose: async () => undefined },
      heartbeat: { stop: () => undefined },
    },
  };

  __setWalletConnectModuleLoader(async (specifier) => {
    if (specifier === '@walletconnect/sign-client') {
      return { SignClient: { init: async () => fakeClient } };
    }
    if (specifier === '@walletconnect/utils') {
      return {
        parseUri: (uri: string) => ({ topic: uri.slice('wc:'.length, uri.indexOf('@')) }),
        buildApprovedNamespaces: ({
          supportedNamespaces,
        }: {
          supportedNamespaces: Record<string, unknown>;
        }) => ({ eip155: supportedNamespaces.eip155 }),
        getSdkError: (code: string) => ({ code }),
      };
    }
    throw new Error(`Unexpected module ${specifier}`);
  });

  let wc: WalletConnectWallet | undefined;
  try {
    wc = await WalletConnectWallet.create({
      wallet,
      projectId: 'irrelevant',
      enforceOrigins: false,
      sessionAuthenticate: false,
    });
    await wc.pair({ uri: 'wc:topic-1@2?symKey=abc' });
    await wc.pair({ uri: 'wc:topic-2@2?symKey=def' });

    await wallet.switchNetwork('0xaa36a7');
    await expect.poll(() => updates.map((update) => update.topic)).toEqual([
      'session-topic-1',
      'session-topic-2',
    ]);
    expect(
      updates.map(
        (update) =>
          (update.namespaces.eip155 as { chains?: string[]; accounts?: string[] } | undefined)?.chains,
      ),
    ).toEqual([
      ['eip155:31337', 'eip155:11155111'],
      ['eip155:31337', 'eip155:11155111'],
    ]);
    expect(
      updates.map(
        (update) =>
          (update.namespaces.eip155 as { chains?: string[]; accounts?: string[] } | undefined)?.accounts,
      ),
    ).toEqual([
      [`eip155:31337:${wallet.primaryAccount}`, `eip155:11155111:${wallet.primaryAccount}`],
      [`eip155:31337:${wallet.primaryAccount}`, `eip155:11155111:${wallet.primaryAccount}`],
    ]);
    expect(emitted).toEqual([
      {
        topic: 'session-topic-1',
        event: { name: 'chainChanged', data: 11155111 },
        chainId: 'eip155:11155111',
      },
      {
        topic: 'session-topic-2',
        event: { name: 'chainChanged', data: 11155111 },
        chainId: 'eip155:11155111',
      },
    ]);
  } finally {
    await wc?.close();
    __setWalletConnectModuleLoader();
  }
});

test('persona WalletConnect links format mobile and QR launch URIs', () => {
  const uri = 'wc:test-topic@2?relay-protocol=irn&symKey=abc+123';

  expect(formatWalletConnectUriForPersona(uri, walletPersonas.metamask())).toBe(
    `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.bitget())).toBe(
    `bitkeep://wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.tokenPocket())).toBe(
    `tpoutside://wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.safePal())).toBe(
    `safepalwallet://wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.binance())).toBe(
    `bnc://app.binance.com/cedefi/wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.trust())).toBe(
    `trust://wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.okx())).toBe(
    `okex://main/wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.imToken())).toBe(
    `imtokenv2://wc?uri=${encodeURIComponent(uri)}`,
  );
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.frontier())).toBe(
    `frontier://wc?uri=${encodeURIComponent(uri)}`,
  );

  expect(formatWalletConnectUriForPersona(uri, walletPersonas.coinbase())).toBe(uri);
  expect(formatWalletConnectUriForPersona(uri, walletPersonas.safePal(), 'qrCode')).toBe(uri);
  expect(walletConnectLinksForPersona(walletPersonas.metamask())).toMatchObject({
    mobile: 'https://metamask.app.link/wc?uri={uri}',
  });
  expect(walletConnectMetadataForPersona(walletPersonas.metamask())).not.toHaveProperty('links');

  const custom = createWalletPersona({
    name: 'Custom Wallet',
    walletConnect: {
      links: {
        mobile: 'custom://wc/{rawUri}',
        qrCode: 'https://scan.example/?uri={uri}',
      },
    },
  });
  expect(formatWalletConnectUriForPersona(uri, custom)).toBe(`custom://wc/${uri}`);
  expect(formatWalletConnectUriForPersona(uri, custom, 'qrCode')).toBe(
    `https://scan.example/?uri=${encodeURIComponent(uri)}`,
  );
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
    } as Parameters<typeof buildApprovedNamespaces>[0]['proposal'],
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

test('default WalletConnect EVM namespace advertises EIP-5792 batch methods', async ({
  wallet,
}) => {
  const namespaces = buildApprovedNamespaces({
    proposal: {
      id: 1,
      pairingTopic: 'x',
      expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
      relays: [{ protocol: 'irn' }],
      proposer: { publicKey: 'pk', metadata: { name: 'dapp', description: '', url: '', icons: [] } },
      requiredNamespaces: {
        eip155: {
          chains: ['eip155:31337'],
          methods: [
            'wallet_getCapabilities',
            'wallet_sendCalls',
            'wallet_getCallsStatus',
            'wallet_showCallsStatus',
          ],
          events: ['chainChanged', 'accountsChanged'],
        },
      },
      optionalNamespaces: {},
    } as Parameters<typeof buildApprovedNamespaces>[0]['proposal'],
    supportedNamespaces: {
      eip155: {
        chains: ['eip155:31337'],
        methods: [...DEFAULT_WALLETCONNECT_METHODS],
        events: ['chainChanged', 'accountsChanged'],
        accounts: [`eip155:31337:${wallet.primaryAccount}`],
      },
    },
  });

  expect(namespaces.eip155?.methods).toEqual(
    expect.arrayContaining([
      'wallet_getCapabilities',
      'wallet_sendCalls',
      'wallet_getCallsStatus',
      'wallet_showCallsStatus',
    ]),
  );
});

test('AppKit-style optionalNamespaces proposals can include Solana for Solana personas', async () => {
  const publicKey = '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo';
  const namespaces = buildApprovedNamespaces({
    proposal: {
      id: 1,
      pairingTopic: 'x',
      expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
      relays: [{ protocol: 'irn' }],
      proposer: { publicKey: 'pk', metadata: { name: 'dapp', description: '', url: '', icons: [] } },
      requiredNamespaces: {},
      optionalNamespaces: {
        solana: {
          chains: ['solana:mainnet', 'solana:testnet'],
          methods: ['solana_getAccounts', 'solana_signMessage'],
          events: ['accountsChanged'],
        },
      },
    } as Parameters<typeof buildApprovedNamespaces>[0]['proposal'],
    supportedNamespaces: {
      solana: {
        chains: ['solana:mainnet'],
        methods: ['solana_getAccounts', 'solana_signMessage'],
        events: ['accountsChanged'],
        accounts: [`solana:mainnet:${publicKey}`],
      },
    },
  });

  expect(namespaces.solana?.chains).toEqual(['solana:mainnet']);
  expect(namespaces.solana?.accounts).toEqual([`solana:mainnet:${publicKey}`]);
  expect(namespaces.solana?.methods).toEqual(['solana_getAccounts', 'solana_signMessage']);
});
