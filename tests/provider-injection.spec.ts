import { expect, test } from '../src/fixtures.js';
import { MockWalletController } from '../src/mock-wallet-controller.js';
import { majorWalletPersonas, walletPersonas } from '../src/wallet-personas.js';

test('injects an EIP-1193 and EIP-6963 mock wallet before app scripts run', async ({ page, wallet }) => {
  expect(wallet.primaryAccount).toMatch(/^0x/);

  const html = `
    <script>
      window.detected = {
        hasEthereum: Boolean(window.ethereum),
        chainId: window.ethereum?.chainId,
        accounts: undefined,
        announcements: 0,
      };

      window.addEventListener('eip6963:announceProvider', (event) => {
        window.detected.announcements += Number(event.detail.info.name === 'Mock Wallet');
      });

      window.dispatchEvent(new Event('eip6963:requestProvider'));
    </script>
  `;

  await page.goto(`data:text/html,${encodeURIComponent(html)}`);

  const detected = await page.evaluate(async () => {
    window.detected.accounts = (await window.ethereum.request({
      method: 'eth_accounts',
    })) as string[];
    return window.detected;
  });

  expect(detected.hasEthereum).toBe(true);
  expect(detected.chainId).toBe('0x7a69');
  expect(detected.accounts).toEqual([wallet.primaryAccount]);
  expect(detected.announcements).toBeGreaterThan(0);
});

test('EIP-1193 provider supports common EventEmitter aliases and initial connect', async ({
  page,
  wallet,
}) => {
  void wallet;
  const html = `
    <script>
      window.results = {
        connectEvents: [],
        listenerCountAfterOn: 0,
        listenerCountAfterOff: 0,
        listenersArray: false,
        addListenerReturnedProvider: false,
        offReturnedProvider: false,
      };

      const ignored = () => {};
      window.results.addListenerReturnedProvider =
        window.ethereum.addListener('connect', ignored) === window.ethereum;
      window.results.offReturnedProvider =
        window.ethereum.off('connect', ignored) === window.ethereum;

      window.ethereum.on('connect', (payload) => {
        window.results.connectEvents.push(payload);
      });
      window.results.listenerCountAfterOn = window.ethereum.listenerCount('connect');
      window.results.listenersArray = Array.isArray(window.ethereum.listeners('connect'));
      window.ethereum.once('accountsChanged', () => {
        window.results.onceObserved = true;
      });
    </script>
  `;

  await page.goto(`data:text/html,${encodeURIComponent(html)}`);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const results = window.results as {
          connectEvents: { chainId?: string }[];
          listenerCountAfterOn: number;
          listenersArray: boolean;
          addListenerReturnedProvider: boolean;
          offReturnedProvider: boolean;
        };
        return {
          connectEvents: results.connectEvents,
          listenerCountAfterOn: results.listenerCountAfterOn,
          listenersArray: results.listenersArray,
          addListenerReturnedProvider: results.addListenerReturnedProvider,
          offReturnedProvider: results.offReturnedProvider,
        };
      }),
    )
    .toEqual({
      connectEvents: [{ chainId: '0x7a69' }],
      listenerCountAfterOn: 1,
      listenersArray: true,
      addListenerReturnedProvider: true,
      offReturnedProvider: true,
    });
});

test.describe('wallet personas', () => {
  test.use({
    walletOptions: {
      persona: walletPersonas.rabby(),
      additionalPersonas: [walletPersonas.coinbase(), walletPersonas.phantomEvm()],
    },
  });

  test('exposes wallet-specific EIP-6963 metadata, flags, and aliases', async ({ page, wallet }) => {
    expect(wallet.providerInfo.rdns).toBe('io.rabby');
    const detected = await page.evaluate(async () => {
      const announced: {
        rdns: string;
        name: string;
        isPrimary: boolean;
        flags: Record<string, boolean>;
      }[] = [];

      window.addEventListener('eip6963:announceProvider', (event) => {
        const detail = (event as CustomEvent<{
          info: { rdns: string; name: string };
          provider: Record<string, unknown>;
        }>).detail;
        if (!detail?.info || !detail.provider) return;
        announced.push({
          rdns: detail.info.rdns,
          name: detail.info.name,
          isPrimary: detail.provider === window.ethereum,
          flags: {
            isRabby: detail.provider.isRabby === true,
            isCoinbaseWallet: detail.provider.isCoinbaseWallet === true,
            isPhantom: detail.provider.isPhantom === true,
          },
        });
      });
      window.dispatchEvent(new Event('eip6963:requestProvider'));

      return {
        announced,
        primary: {
          isRabby: window.ethereum.isRabby === true,
          isMetaMask: window.ethereum.isMetaMask === true,
          info: window.ethereum.info,
          infoFrozen: Object.isFrozen(window.ethereum.info),
        },
        legacyProviders: await Promise.all(
          (window.ethereum.providers ?? []).map(async (provider) => ({
            isPrimary: provider === window.ethereum,
            info: provider.info,
            infoFrozen: Object.isFrozen(provider.info),
            isRabby: provider.isRabby === true,
            isCoinbaseWallet: provider.isCoinbaseWallet === true,
            isPhantom: provider.isPhantom === true,
            chainId: await provider.request({ method: 'eth_chainId' }),
          })),
        ),
        aliases: {
          coinbase: {
            flag: window.coinbaseWalletExtension?.isCoinbaseWallet === true,
            info: window.coinbaseWalletExtension?.info,
          },
          phantom: {
            flag: window.phantom?.ethereum?.isPhantom === true,
            info: window.phantom?.ethereum?.info,
          },
          phantomChainId: await window.phantom?.ethereum?.request({ method: 'eth_chainId' }),
          phantomSolana: {
            sameAsGlobal: window.phantom?.solana === window.solana,
            isPhantom: window.phantom?.solana?.isPhantom === true,
            info: window.phantom?.solana?.info,
            infoFrozen: Object.isFrozen(window.phantom?.solana?.info),
          },
        },
      };
    });

    expect(detected.announced.map((entry) => entry.rdns)).toEqual([
      'io.rabby',
      'io.coinbase',
      'app.phantom',
    ]);
    expect(detected.announced.map((entry) => entry.isPrimary)).toEqual([true, false, false]);
    expect(detected.announced.map((entry) => entry.flags)).toEqual([
      { isRabby: true, isCoinbaseWallet: false, isPhantom: false },
      { isRabby: false, isCoinbaseWallet: true, isPhantom: false },
      { isRabby: false, isCoinbaseWallet: false, isPhantom: true },
    ]);
    expect(detected.primary).toEqual({
      isRabby: true,
      isMetaMask: false,
      info: expect.objectContaining({
        name: 'Rabby Wallet',
        rdns: 'io.rabby',
      }),
      infoFrozen: true,
    });
    expect(detected.legacyProviders).toEqual([
      {
        isPrimary: true,
        info: expect.objectContaining({ name: 'Rabby Wallet', rdns: 'io.rabby' }),
        infoFrozen: true,
        isRabby: true,
        isCoinbaseWallet: false,
        isPhantom: false,
        chainId: '0x7a69',
      },
      {
        isPrimary: false,
        info: expect.objectContaining({ name: 'Coinbase Wallet', rdns: 'io.coinbase' }),
        infoFrozen: true,
        isRabby: false,
        isCoinbaseWallet: true,
        isPhantom: false,
        chainId: '0x7a69',
      },
      {
        isPrimary: false,
        info: expect.objectContaining({ name: 'Phantom', rdns: 'app.phantom' }),
        infoFrozen: true,
        isRabby: false,
        isCoinbaseWallet: false,
        isPhantom: true,
        chainId: '0x7a69',
      },
    ]);
    expect(detected.aliases).toEqual({
      coinbase: {
        flag: true,
        info: expect.objectContaining({ name: 'Coinbase Wallet', rdns: 'io.coinbase' }),
      },
      phantom: {
        flag: true,
        info: expect.objectContaining({ name: 'Phantom', rdns: 'app.phantom' }),
      },
      phantomChainId: '0x7a69',
      phantomSolana: {
        sameAsGlobal: true,
        isPhantom: true,
        info: expect.objectContaining({ name: 'Phantom', rdns: 'app.phantom' }),
        infoFrozen: true,
      },
    });
  });
});

test.describe('Phantom Solana provider surface', () => {
  test.use({
    walletOptions: {
      persona: walletPersonas.phantomEvm(),
    },
  });

  test('supports Phantom-style Solana discovery, connect, request, and signMessage', async ({ page, wallet }) => {
    void wallet;
    const detected = await page.evaluate(async () => {
      const provider = window.phantom?.solana;
      if (!provider || provider !== window.solana) {
        return { ok: false as const };
      }

      const events: string[] = [];
      const ignored = () => undefined;
      const addListenerReturnedProvider = provider.addListener('connect', ignored) === provider;
      const offReturnedProvider = provider.off('connect', ignored) === provider;
      provider.on('connect', (publicKey) => {
        events.push(`connect:${(publicKey as { toString: () => string }).toString()}`);
      });
      provider.on('disconnect', () => {
        events.push('disconnect');
      });
      const listenerCountAfterOn = provider.listenerCount('connect');
      const listenersArray = Array.isArray(provider.listeners('connect'));

      let eagerError: { code?: number; message?: string } | undefined;
      try {
        await provider.connect({ onlyIfTrusted: true });
      } catch (error) {
        const err = error as { code?: number; message?: string };
        eagerError = { code: err.code, message: err.message };
      }

      const solanaAccounts = (accounts: unknown[]) =>
        accounts.map((account) => {
          const value = account as {
            publicKey?: { toString: () => string };
            pubkey?: string;
            address?: string;
          };
          return {
            publicKey: value.publicKey?.toString(),
            pubkey: value.pubkey,
            address: value.address,
          };
        });
      const accountsBeforeConnect = (await provider.request({ method: 'getAccounts' })) as string[];
      const solanaAccountsBeforeConnect = solanaAccounts(
        (await provider.request({ method: 'solana_getAccounts' })) as unknown[],
      );
      const connected = await provider.connect();
      const requestConnected = (await provider.request({ method: 'connect' })) as {
        publicKey: { toString: () => string };
      };
      const connectedBytes = Array.from(connected.publicKey.toBytes());
      const connectedAsciiBytes = Array.from(new TextEncoder().encode(connected.publicKey.toString()));
      const requestAccounts = (await provider.request({ method: 'requestAccounts' })) as string[];
      const solanaRequestAccounts = solanaAccounts(
        (await provider.request({ method: 'solana_requestAccounts' })) as unknown[],
      );
      const solanaGetAccounts = solanaAccounts(
        (await provider.request({ method: 'solana_getAccounts' })) as unknown[],
      );
      const message = new TextEncoder().encode('hello phantom');
      const signed = await provider.signMessage(message);
      const requestSigned = (await provider.request({
        method: 'solana_signMessage',
        params: { message },
      })) as { publicKey: { toString: () => string }; signature: Uint8Array };
      const signIn = await provider.signIn({
        domain: 'example.test',
        statement: 'Testing Solana sign-in',
        nonce: 'phantom-nonce',
      });
      const sent = await provider.signAndSendTransaction({ recentBlockhash: 'mock' });
      const sentAll = await provider.signAndSendAllTransactions([
        { recentBlockhash: 'first' },
        { recentBlockhash: 'second' },
      ]);
      const requestSignedAll = (await provider.request({
        method: 'signAllTransactions',
        params: [{ recentBlockhash: 'one' }, { recentBlockhash: 'two' }],
      })) as unknown[];
      const requestSentAll = (await provider.request({
        method: 'signAndSendAllTransactions',
        params: { transactions: [{ recentBlockhash: 'third' }] },
      })) as { publicKey: { toString: () => string }; signatures: string[] };
      await provider.request({ method: 'disconnect' });
      const trustedReconnect = await provider.connect({ onlyIfTrusted: true });
      const isConnectedAfterTrustedReconnect = provider.isConnected;
      await provider.disconnect();

      return {
        ok: true as const,
        eagerError,
        isPhantom: provider.isPhantom === true,
        accountsBeforeConnect,
        solanaAccountsBeforeConnect,
        connectedKey: connected.publicKey.toString(),
        connectedBytesLength: connectedBytes.length,
        connectedBytesAreAsciiText: JSON.stringify(connectedBytes) === JSON.stringify(connectedAsciiBytes),
        requestKey: requestConnected.publicKey.toString(),
        requestAccounts,
        solanaRequestAccounts,
        solanaGetAccounts,
        signedKey: signed.publicKey.toString(),
        requestSignedKey: requestSigned.publicKey.toString(),
        signatureLength: signed.signature.length,
        requestSignatureLength: requestSigned.signature.length,
        signInAddress: signIn.address,
        signInSignatureLength: signIn.signature.length,
        signInMessage: new TextDecoder().decode(signIn.signedMessage),
        sentSignatureLength: sent.signature.length,
        sentAllKey: sentAll.publicKey.toString(),
        sentAllSignatureLengths: sentAll.signatures.map((signature) => signature.length),
        requestSignedAllLength: requestSignedAll.length,
        requestSentAllKey: requestSentAll.publicKey.toString(),
        requestSentAllSignatureLengths: requestSentAll.signatures.map((signature) => signature.length),
        trustedReconnectKey: trustedReconnect.publicKey.toString(),
        isConnectedAfterTrustedReconnect,
        isConnectedAfterDisconnect: provider.isConnected,
        publicKeyAfterDisconnect: provider.publicKey?.toString() ?? null,
        events,
        addListenerReturnedProvider,
        offReturnedProvider,
        listenerCountAfterOn,
        listenersArray,
      };
    });

    expect(detected).toMatchObject({
      ok: true,
      eagerError: { code: 4001, message: 'User rejected the request.' },
      isPhantom: true,
      accountsBeforeConnect: [],
      solanaAccountsBeforeConnect: [],
      connectedKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      connectedBytesLength: 32,
      connectedBytesAreAsciiText: false,
      requestKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      requestAccounts: ['26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo'],
      solanaRequestAccounts: [{
        publicKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        pubkey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        address: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      }],
      solanaGetAccounts: [{
        publicKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        pubkey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        address: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      }],
      signedKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      requestSignedKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      signatureLength: 64,
      requestSignatureLength: 64,
      signInAddress: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      signInSignatureLength: 64,
      sentSignatureLength: 128,
      sentAllKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      sentAllSignatureLengths: [128, 128],
      requestSignedAllLength: 2,
      requestSentAllKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      requestSentAllSignatureLengths: [128],
      trustedReconnectKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      isConnectedAfterTrustedReconnect: true,
      isConnectedAfterDisconnect: false,
      publicKeyAfterDisconnect: null,
      addListenerReturnedProvider: true,
      offReturnedProvider: true,
      listenerCountAfterOn: 1,
      listenersArray: true,
      events: [
        'connect:26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        'disconnect',
        'connect:26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        'disconnect',
      ],
    });
    expect(detected.signInMessage).toContain('example.test wants you to sign in');
    expect(detected.signInMessage).toContain('Testing Solana sign-in');
    expect(detected.signInMessage).toContain('Nonce: phantom-nonce');
  });

  test('controller lock hides and restores connected Solana providers', async ({
    page,
    wallet,
  }) => {
    const before = await page.evaluate(async () => {
      const provider = window.solana!;
      const accountEvents: Array<string | null> = [];
      const disconnectEvents: string[] = [];
      provider.on('accountChanged', (publicKey) => {
        accountEvents.push(
          publicKey && typeof publicKey === 'object' && 'toString' in publicKey
            ? (publicKey as { toString: () => string }).toString()
            : null,
        );
      });
      provider.on('disconnect', () => {
        disconnectEvents.push('disconnect');
      });

      type StandardWallet = {
        name: string;
        accounts: readonly unknown[];
        features: {
          'standard:events': { on(event: string, handler: (payload: unknown) => void): () => void };
        };
      };
      const registered: StandardWallet[] = [];
      window.dispatchEvent(
        new CustomEvent('wallet-standard:app-ready', {
          detail: {
            register: (...wallets: StandardWallet[]) => {
              registered.push(...wallets);
              return () => undefined;
            },
          },
        }),
      );
      const standard = registered.find((candidate) => candidate.name === 'Phantom')!;
      const standardChanges: number[] = [];
      standard.features['standard:events'].on('change', (payload) => {
        standardChanges.push((payload as { accounts?: unknown[] }).accounts?.length ?? -1);
      });

      await provider.connect();
      (window as unknown as {
        __solanaLifecycle: {
          accountEvents: Array<string | null>;
          disconnectEvents: string[];
          standard: StandardWallet;
          standardChanges: number[];
        };
      }).__solanaLifecycle = { accountEvents, disconnectEvents, standard, standardChanges };

      return {
        connected: provider.isConnected,
        publicKey: provider.publicKey?.toString() ?? null,
        standardAccounts: standard.accounts.length,
      };
    });

    expect(before).toEqual({
      connected: true,
      publicKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      standardAccounts: 1,
    });

    await wallet.lock();

    const locked = await page.evaluate(async () => {
      let signError: { code?: number; message?: string } | undefined;
      try {
        await window.solana!.signMessage(new TextEncoder().encode('locked'));
      } catch (error) {
        const err = error as { code?: number; message?: string };
        signError = { code: err.code, message: err.message };
      }
      const lifecycle = (window as unknown as {
        __solanaLifecycle: {
          accountEvents: Array<string | null>;
          disconnectEvents: string[];
          standard: { accounts: readonly unknown[] };
          standardChanges: number[];
        };
      }).__solanaLifecycle;

      return {
        connected: window.solana!.isConnected,
        publicKey: window.solana!.publicKey?.toString() ?? null,
        standardAccounts: lifecycle.standard.accounts.length,
        accountEvents: lifecycle.accountEvents,
        standardChanges: lifecycle.standardChanges,
        disconnectEvents: lifecycle.disconnectEvents,
        signError,
      };
    });

    expect(locked).toEqual({
      connected: false,
      publicKey: null,
      standardAccounts: 0,
      accountEvents: [null],
      standardChanges: [1, 0],
      disconnectEvents: [],
      signError: { code: 4100, message: 'The Solana wallet is not connected.' },
    });

    await wallet.unlock();

    const unlocked = await page.evaluate(async () => {
      const signed = await window.solana!.signMessage(new TextEncoder().encode('unlocked'));
      const lifecycle = (window as unknown as {
        __solanaLifecycle: {
          accountEvents: Array<string | null>;
          disconnectEvents: string[];
          standard: { accounts: readonly unknown[] };
          standardChanges: number[];
        };
      }).__solanaLifecycle;

      return {
        connected: window.solana!.isConnected,
        publicKey: window.solana!.publicKey?.toString() ?? null,
        standardAccounts: lifecycle.standard.accounts.length,
        accountEvents: lifecycle.accountEvents,
        standardChanges: lifecycle.standardChanges,
        disconnectEvents: lifecycle.disconnectEvents,
        signatureLength: signed.signature.length,
      };
    });

    expect(unlocked).toEqual({
      connected: true,
      publicKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      standardAccounts: 1,
      accountEvents: [null, '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo'],
      standardChanges: [1, 0, 1],
      disconnectEvents: [],
      signatureLength: 64,
    });

    await wallet.disconnect();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const lifecycle = (window as unknown as {
            __solanaLifecycle: {
              accountEvents: Array<string | null>;
              disconnectEvents: string[];
              standard: { accounts: readonly unknown[] };
              standardChanges: number[];
            };
          }).__solanaLifecycle;
          return {
            connected: window.solana!.isConnected,
            publicKey: window.solana!.publicKey?.toString() ?? null,
            standardAccounts: lifecycle.standard.accounts.length,
            accountEvents: lifecycle.accountEvents,
            standardChanges: lifecycle.standardChanges,
            disconnectEvents: lifecycle.disconnectEvents,
          };
        }),
      )
      .toEqual({
        connected: false,
        publicKey: null,
        standardAccounts: 0,
        accountEvents: [null, '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo', null],
        standardChanges: [1, 0, 1, 0],
        disconnectEvents: ['disconnect'],
      });
  });

  test('registers a Solana Wallet Standard wallet for wallet-adapter discovery', async ({ page, wallet }) => {
    void wallet;
    const detected = await page.evaluate(async () => {
      type StandardWallet = {
        name: string;
        version: string;
        chains: readonly string[];
        accounts: readonly {
          address: string;
          publicKey: Uint8Array;
          chains: readonly string[];
          features: readonly string[];
        }[];
        features: {
          'standard:connect': {
            connect(input?: { silent?: boolean }): Promise<{ accounts: StandardWallet['accounts'] }>;
          };
          'standard:disconnect': { disconnect(): Promise<void> };
          'standard:events': { on(event: string, handler: (payload: unknown) => void): () => void };
          'solana:signIn': {
            signIn(
              ...inputs: Record<string, unknown>[]
            ): Promise<
              { account: StandardWallet['accounts'][number]; signedMessage: Uint8Array; signature: Uint8Array }[]
            >;
          };
          'solana:signMessage': {
            signMessage(input: {
              account: StandardWallet['accounts'][number];
              message: Uint8Array;
            }): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }[]>;
          };
          'solana:signAndSendTransaction': {
            signAndSendTransaction(input: {
              account: StandardWallet['accounts'][number];
              chain: string;
              transaction: Uint8Array;
            }): Promise<{ signature: Uint8Array }[]>;
          };
        };
      };

      const registered: StandardWallet[] = [];
      const api = {
        register: (...wallets: StandardWallet[]) => {
          registered.push(...wallets);
          return () => undefined;
        },
      };
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));

      const standard = registered.find((candidate) => candidate.name === 'Phantom');
      if (!standard) {
        return { ok: false as const, names: registered.map((candidate) => candidate.name) };
      }

      const changes: number[] = [];
      standard.features['standard:events'].on('change', (payload) => {
        changes.push((payload as { accounts?: unknown[] }).accounts?.length ?? -1);
      });

      let silentError: { code?: number; message?: string } | undefined;
      try {
        await standard.features['standard:connect'].connect({ silent: true });
      } catch (error) {
        const err = error as { code?: number; message?: string };
        silentError = { code: err.code, message: err.message };
      }

      const connected = await standard.features['standard:connect'].connect();
      const [account] = connected.accounts;
      const [signInResult] = await standard.features['solana:signIn'].signIn({
        domain: 'example.test',
        statement: 'Wallet Standard sign-in',
        nonce: 'standard-nonce',
      });
      const [messageResult] = await standard.features['solana:signMessage'].signMessage({
        account: account!,
        message: new TextEncoder().encode('wallet standard'),
      });
      const [sendResult] = await standard.features['solana:signAndSendTransaction'].signAndSendTransaction({
        account: account!,
        chain: 'solana:devnet',
        transaction: new Uint8Array([1, 2, 3]),
      });
      await standard.features['standard:disconnect'].disconnect();
      const trustedSilent = await standard.features['standard:connect'].connect({ silent: true });
      await standard.features['standard:disconnect'].disconnect();

      return {
        ok: true as const,
        silentError,
        registeredNames: registered.map((candidate) => candidate.name),
        chains: [...standard.chains],
        featureNames: Object.keys(standard.features).sort(),
        connectedAccounts: connected.accounts.length,
        account: {
          address: account?.address,
          publicKeyLength: account?.publicKey.length,
          chains: [...(account?.chains ?? [])],
          features: [...(account?.features ?? [])].sort(),
        },
        signInAccount: signInResult?.account.address,
        signInSignatureLength: signInResult?.signature.length,
        signInMessage: new TextDecoder().decode(signInResult?.signedMessage ?? new Uint8Array()),
        messageSignatureLength: messageResult?.signature.length,
        signedMessageLength: messageResult?.signedMessage.length,
        sentSignatureLength: sendResult?.signature.length,
        trustedSilentAccounts: trustedSilent.accounts.length,
        accountCountAfterDisconnect: standard.accounts.length,
        directProviderConnected: window.phantom?.solana?.isConnected,
        changes,
      };
    });

    expect(detected).toEqual({
      ok: true,
      silentError: { code: 4001, message: 'User rejected the request.' },
      registeredNames: ['Phantom'],
      chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet'],
      featureNames: [
        'solana:signAndSendTransaction',
        'solana:signIn',
        'solana:signMessage',
        'solana:signTransaction',
        'standard:connect',
        'standard:disconnect',
        'standard:events',
      ],
      connectedAccounts: 1,
      account: {
        address: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        publicKeyLength: 32,
        chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet'],
        features: [
          'solana:signAndSendTransaction',
          'solana:signIn',
          'solana:signMessage',
          'solana:signTransaction',
        ],
      },
      signInAccount: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
      signInSignatureLength: 64,
      signInMessage:
        'example.test wants you to sign in with your Solana account:\n' +
        '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo\n\n' +
        'Wallet Standard sign-in\n' +
        'Nonce: standard-nonce',
      messageSignatureLength: 64,
      signedMessageLength: 15,
      sentSignatureLength: 64,
      trustedSilentAccounts: 1,
      accountCountAfterDisconnect: 0,
      directProviderConnected: false,
      changes: [1, 0, 1, 0],
    });
  });
});

test.describe('Solana provider controller gates', () => {
  test.use({
    walletOptions: {
      autoApprove: false,
      persona: walletPersonas.phantomEvm(),
    },
  });

  test('routes direct Solana connect and signing through approval and hardware gates', async ({
    page,
    wallet,
  }) => {
    const capture = async (operation: string) =>
      page.evaluate(async (target) => {
        const errorResult = (error: unknown) => {
          const err = error as { code?: number; message?: string };
          return { ok: false as const, code: err.code, message: err.message };
        };

        try {
          switch (target) {
            case 'connect': {
              const result = await window.solana!.connect();
              return { ok: true as const, publicKey: result.publicKey.toString() };
            }
            case 'signMessage': {
              const result = await window.solana!.signMessage(new TextEncoder().encode('gate me'));
              return { ok: true as const, signatureLength: result.signature.length };
            }
            case 'signIn': {
              const result = await window.solana!.signIn({
                domain: 'gate.test',
                statement: 'Approval gated',
                nonce: 'solana-gate',
              });
              return {
                ok: true as const,
                signatureLength: result.signature.length,
                message: new TextDecoder().decode(result.signedMessage),
              };
            }
            default:
              throw new Error(`Unknown operation: ${target}`);
          }
        } catch (error) {
          return errorResult(error);
        }
      }, operation);

    expect(await capture('connect')).toMatchObject({
      ok: false,
      code: 4001,
      message: 'User rejected the request.',
    });

    wallet.approveNext('solana_requestAccounts');
    expect(await capture('connect')).toMatchObject({
      ok: true,
      publicKey: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
    });

    expect(await capture('signMessage')).toMatchObject({
      ok: false,
      code: 4001,
      message: 'User rejected the request.',
    });

    wallet.approveNext('solana_signMessage');
    expect(await capture('signMessage')).toMatchObject({
      ok: true,
      signatureLength: 64,
    });

    expect(await capture('signIn')).toMatchObject({
      ok: false,
      code: 4001,
      message: 'User rejected the request.',
    });

    wallet.approveNext('solana_signIn');
    const signIn = await capture('signIn');
    expect(signIn).toMatchObject({
      ok: true,
      signatureLength: 64,
    });
    expect(signIn.ok ? signIn.message : '').toContain('gate.test wants you to sign in');
    expect(signIn.ok ? signIn.message : '').toContain('Nonce: solana-gate');

    wallet.configureHardwareWallet({
      approvalDelayMs: 0,
      requiredApps: { solana_signMessage: 'Phantom Solana' },
    });
    wallet.setHardwareWalletState('wrong-app');
    wallet.approveNext('solana_signMessage');

    expect(await capture('signMessage')).toMatchObject({
      ok: false,
      code: 4001,
      message: 'Open the Phantom Solana app on your hardware wallet and try again.',
    });
  });
});

test.describe('multi-wallet Solana Wallet Standard discovery', () => {
  test.use({
    walletOptions: {
      persona: walletPersonas.phantomEvm(),
      additionalPersonas: [walletPersonas.backpack(), walletPersonas.safePal()],
    },
  });

  test('registers every configured Solana persona and keeps aliases distinct', async ({ page, wallet }) => {
    void wallet;
    const detected = await page.evaluate(async () => {
      type StandardWallet = {
        name: string;
        chains: readonly string[];
        accounts: readonly { address: string; features: readonly string[] }[];
        features: {
          'standard:connect': {
            connect(input?: { silent?: boolean }): Promise<{ accounts: StandardWallet['accounts'] }>;
          };
          'standard:disconnect': { disconnect(): Promise<void> };
          'solana:signIn': {
            signIn(
              ...inputs: Record<string, unknown>[]
            ): Promise<
              { account: StandardWallet['accounts'][number]; signedMessage: Uint8Array; signature: Uint8Array }[]
            >;
          };
        };
      };

      const registered: StandardWallet[] = [];
      window.dispatchEvent(
        new CustomEvent('wallet-standard:app-ready', {
          detail: {
            register: (...wallets: StandardWallet[]) => {
              registered.push(...wallets);
              return () => undefined;
            },
          },
        }),
      );

      const summaries = [];
      for (const name of ['Phantom', 'Backpack', 'SafePal']) {
        const standard = registered.find((candidate) => candidate.name === name);
        if (!standard) {
          summaries.push({ name, missing: true });
          continue;
        }
        const connected = await standard.features['standard:connect'].connect();
        const [signIn] = await standard.features['solana:signIn'].signIn({
          domain: `${name.toLowerCase()}.test`,
          nonce: `${name}-nonce`,
        });
        summaries.push({
          name,
          address: connected.accounts[0]?.address,
          signInAccount: signIn?.account.address,
          signInSignatureLength: signIn?.signature.length,
          signInMessage: new TextDecoder().decode(signIn?.signedMessage ?? new Uint8Array()),
          chains: [...standard.chains],
          accountFeatures: [...(connected.accounts[0]?.features ?? [])].sort(),
        });
        await standard.features['standard:disconnect'].disconnect();
      }

      return {
        registeredNames: registered.map((candidate) => candidate.name),
        summaries,
        aliases: {
          phantomGlobal: window.phantom?.solana === window.solana,
          backpackFlag: window.backpack?.solana?.isBackpack === true,
          safePalFlag: window.safepal?.isSafePal === true,
          distinctProviders:
            new Set([window.phantom?.solana, window.backpack?.solana, window.safepal]).size === 3,
        },
      };
    });

    expect(detected.registeredNames).toEqual(['Phantom', 'Backpack', 'SafePal']);
    expect(detected.aliases).toEqual({
      phantomGlobal: true,
      backpackFlag: true,
      safePalFlag: true,
      distinctProviders: true,
    });
    expect(detected.summaries).toEqual([
      expect.objectContaining({
        name: 'Phantom',
        address: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        signInAccount: '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        signInSignatureLength: 64,
      }),
      expect.objectContaining({
        name: 'Backpack',
        address: '8xX7qT9N4z2Wm6YQNz3dLqHpspRrQ2Xrcrk22eL8D4sP',
        signInAccount: '8xX7qT9N4z2Wm6YQNz3dLqHpspRrQ2Xrcrk22eL8D4sP',
        signInSignatureLength: 64,
      }),
      expect.objectContaining({
        name: 'SafePal',
        address: '7uLt9S3qJbXf6YoTvtWKybB7FKYSMNmV7oyG4iXKPrHM',
        signInAccount: '7uLt9S3qJbXf6YoTvtWKybB7FKYSMNmV7oyG4iXKPrHM',
        signInSignatureLength: 64,
      }),
    ]);
    for (const summary of detected.summaries) {
      expect(summary.chains).toEqual(['solana:mainnet', 'solana:devnet', 'solana:testnet']);
      expect(summary.accountFeatures).toEqual([
        'solana:signAndSendTransaction',
        'solana:signIn',
        'solana:signMessage',
        'solana:signTransaction',
      ]);
      expect(summary.signInMessage).toContain(`${summary.name.toLowerCase()}.test wants you to sign in`);
    }
  });
});

test('built-in major wallet personas have stable unique EIP-6963 identities', () => {
  const personas = majorWalletPersonas();
  expect(new Set(personas.map((persona) => persona.rdns)).size).toBe(personas.length);
  expect(personas.map((persona) => persona.rdns)).toEqual(
    expect.arrayContaining([
      'io.metamask',
      'io.rabby',
      'io.coinbase',
      'app.phantom',
      'com.solflare',
      'global.safe',
      'com.bitget.web3',
      'pro.tokenpocket',
      'com.binance.wallet',
      'org.uniswap',
      'xyz.argent',
      'com.exodus',
      'com.fireblocks',
    ]),
  );
});

test.describe('major wallet discovery surfaces', () => {
  test.use({
    walletOptions: {
      persona: walletPersonas.metamask(),
      additionalPersonas: majorWalletPersonas().slice(1),
    },
  });

  test('exposes built-in persona flags, legacy provider array entries, and known globals', async ({ page, wallet }) => {
    void wallet;
    const detected = await page.evaluate(async () => {
      const providers = window.ethereum.providers ?? [window.ethereum];
      const flagSummary = providers.map((provider) => ({
        isMetaMask: provider.isMetaMask === true,
        isRabby: provider.isRabby === true,
        isCoinbaseWallet: provider.isCoinbaseWallet === true,
        isPhantom: provider.isPhantom === true,
        isRainbow: provider.isRainbow === true,
        isOkxWallet: provider.isOkxWallet === true,
        isOKExWallet: provider.isOKExWallet === true,
        isTrustWallet: provider.isTrustWallet === true,
        isBraveWallet: provider.isBraveWallet === true,
        isZerion: provider.isZerion === true,
        isBackpack: provider.isBackpack === true,
        isLedgerWallet: provider.isLedgerWallet === true,
        isTrezor: provider.isTrezor === true,
        isSafe: provider.isSafe === true,
        isBitKeep: provider.isBitKeep === true,
        isBitgetWallet: provider.isBitgetWallet === true,
        isTokenPocket: provider.isTokenPocket === true,
        isSafePal: provider.isSafePal === true,
        isBinance: provider.isBinance === true,
        isExtension: provider.isExtension === true,
        isImToken: provider.isImToken === true,
        isMathWallet: provider.isMathWallet === true,
        isFrame: provider.isFrame === true,
        isEnkrypt: provider.isEnkrypt === true,
        isAvalanche: provider.isAvalanche === true,
        isCoreWallet: provider.isCoreWallet === true,
        isFrontier: provider.isFrontier === true,
        isOneKey: provider.isOneKey === true,
        isCTRL: provider.isCTRL === true,
        isXDEFI: provider.isXDEFI === true,
        isUniswapWallet: provider.isUniswapWallet === true,
        isArgent: provider.isArgent === true,
        isExodus: provider.isExodus === true,
        isFireblocks: provider.isFireblocks === true,
      }));

      return {
        providerCount: providers.length,
        flagSummary,
        aliases: {
          coinbase: window.coinbaseWalletExtension?.isCoinbaseWallet === true,
          phantom: window.phantom?.ethereum?.isPhantom === true,
          okx: {
            flag: window.okxwallet?.isOkxWallet === true,
            chainId: await window.okxwallet?.request({ method: 'eth_chainId' }),
          },
          trust: window.trustwallet?.isTrustWallet === true,
          backpack: {
            flag: window.backpack?.ethereum?.isBackpack === true,
            chainId: await window.backpack?.ethereum?.request({ method: 'eth_chainId' }),
            solana: window.backpack?.solana?.isBackpack === true,
          },
          solflare: {
            flag: window.solflare?.isSolflare === true,
            hasRequest: typeof window.solflare?.request === 'function',
          },
          bitget: {
            flag: window.bitkeep?.isBitKeep === true,
            evmFlag: window.bitkeep?.ethereum?.isBitgetWallet === true,
            chainId: await window.bitkeep?.ethereum?.request({ method: 'eth_chainId' }),
          },
          tokenPocket: {
            flag: window.tokenpocket?.isTokenPocket === true,
            evmFlag: window.tokenpocket?.ethereum?.isTokenPocket === true,
          },
          safePal: {
            evm: window.safepalProvider?.isSafePal === true,
            solana: window.safepal?.isSafePal === true,
          },
          binance: {
            flag: window.binancew3w?.isBinance === true,
            extension: window.binancew3w?.isExtension === true,
            evmFlag: window.binancew3w?.ethereum?.isBinance === true,
          },
          imToken: window.imToken?.isImToken === true,
          enkrypt: window.enkrypt?.providers?.ethereum?.isEnkrypt === true,
          core: window.avalanche?.isAvalanche === true,
          frontier: {
            flag: window.frontier?.isFrontier === true,
            evmFlag: window.frontier?.ethereum?.isFrontier === true,
          },
          oneKey: {
            flag: window.$onekey?.isOneKey === true,
            evmFlag: window.$onekey?.ethereum?.isOneKey === true,
          },
          ctrl: {
            flag: window.ctrl?.isCTRL === true,
            evmFlag: window.ctrl?.ethereum?.isCTRL === true,
            legacy: window.xfi?.ethereum?.isXDEFI === true,
          },
        },
      };
    });

    expect(detected.providerCount).toBe(29);
    expect(detected.flagSummary).toEqual([
      expect.objectContaining({ isMetaMask: true }),
      expect.objectContaining({ isRabby: true }),
      expect.objectContaining({ isCoinbaseWallet: true }),
      expect.objectContaining({ isPhantom: true }),
      expect.objectContaining({ isRainbow: true }),
      expect.objectContaining({ isOkxWallet: true, isOKExWallet: true }),
      expect.objectContaining({ isTrustWallet: true }),
      expect.objectContaining({ isBraveWallet: true, isMetaMask: true }),
      expect.objectContaining({ isZerion: true }),
      expect.objectContaining({ isBackpack: true }),
      expect.objectContaining({ isLedgerWallet: true }),
      expect.objectContaining({ isTrezor: true }),
      expect.objectContaining({ isSafe: true }),
      expect.objectContaining({ isBitKeep: true, isBitgetWallet: true }),
      expect.objectContaining({ isTokenPocket: true }),
      expect.objectContaining({ isSafePal: true }),
      expect.objectContaining({ isBinance: true, isExtension: true }),
      expect.objectContaining({ isImToken: true }),
      expect.objectContaining({ isMathWallet: true }),
      expect.objectContaining({ isFrame: true }),
      expect.objectContaining({ isEnkrypt: true }),
      expect.objectContaining({ isAvalanche: true, isCoreWallet: true }),
      expect.objectContaining({ isFrontier: true }),
      expect.objectContaining({ isOneKey: true }),
      expect.objectContaining({ isCTRL: true, isXDEFI: true }),
      expect.objectContaining({ isUniswapWallet: true }),
      expect.objectContaining({ isArgent: true }),
      expect.objectContaining({ isExodus: true }),
      expect.objectContaining({ isFireblocks: true }),
    ]);
    expect(detected.aliases).toEqual({
      coinbase: true,
      phantom: true,
      okx: { flag: true, chainId: '0x7a69' },
      trust: true,
      backpack: { flag: true, chainId: '0x7a69', solana: true },
      solflare: { flag: true, hasRequest: true },
      bitget: { flag: true, evmFlag: true, chainId: '0x7a69' },
      tokenPocket: { flag: true, evmFlag: true },
      safePal: { evm: true, solana: true },
      binance: { flag: true, extension: true, evmFlag: true },
      imToken: true,
      enkrypt: true,
      core: true,
      frontier: { flag: true, evmFlag: true },
      oneKey: { flag: true, evmFlag: true },
      ctrl: { flag: true, evmFlag: true, legacy: true },
    });
  });
});

test.describe('Solana-only wallet personas', () => {
  test.use({
    walletOptions: {
      persona: walletPersonas.solflare(),
    },
  });

  test('registers Solflare without installing an EVM provider', async ({ page, wallet }) => {
    void wallet;
    const detected = await page.evaluate(async () => {
      const announced: string[] = [];
      window.addEventListener('eip6963:announceProvider', (event) => {
        announced.push((event as CustomEvent<{ info: { rdns: string } }>).detail.info.rdns);
      });
      window.dispatchEvent(new Event('eip6963:requestProvider'));

      const standardWallets: Array<{ name: string; features: string[] }> = [];
      window.dispatchEvent(
        new CustomEvent('wallet-standard:app-ready', {
          detail: {
            register: (standardWallet: { name: string; features: Record<string, unknown> }) => {
              standardWallets.push({
                name: standardWallet.name,
                features: Object.keys(standardWallet.features),
              });
            },
          },
        }),
      );

      const connected = await window.solflare?.connect();
      const signed = await window.solflare?.signMessage(new TextEncoder().encode('hello solflare'));

      return {
        hasEthereum: 'ethereum' in window,
        announced,
        solflare: {
          isSolflare: window.solflare?.isSolflare === true,
          publicKey: connected?.publicKey.toBase58(),
          signatureLength: signed?.signature.length,
        },
        standardWallets,
      };
    });

    expect(detected).toMatchObject({
      hasEthereum: false,
      announced: [],
      solflare: {
        isSolflare: true,
        publicKey: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWkDD5DdnYwB5xP',
        signatureLength: 64,
      },
      standardWallets: [
        {
          name: 'Solflare',
          features: expect.arrayContaining([
            'standard:connect',
            'standard:events',
            'solana:signMessage',
            'solana:signTransaction',
          ]),
        },
      ],
    });
  });
});

test.describe('origin scoping', () => {
  test.use({ walletOptions: { allowedOrigins: ['https://dapp.test'] } });

  const requestAccounts = `
    async () => {
      try {
        return { ok: true, result: await window.ethereum.request({ method: 'eth_accounts' }) };
      } catch (error) {
        return { ok: false, code: error.code, message: error.message };
      }
    }
  `;

  // The bridge binding exists in every frame even where the provider script
  // declined to install — this probes the authoritative server-side check.
  const callBridgeDirectly = `
    async () => {
      const envelope = await window.__invisibleWalletRpcBridge({ method: 'eth_accounts', params: [] });
      return envelope.ok ? { ok: true } : { ok: false, code: envelope.error.code, message: envelope.error.message };
    }
  `;

  test('serves the allowed origin and hides the wallet from frames on other origins', async ({ page, wallet }) => {
    await page.route('**/*', (route) => {
      const body = route.request().url().startsWith('https://evil.test')
        ? '<html><body>embedded</body></html>'
        : '<html><body>dapp<iframe src="https://evil.test/embed"></iframe></body></html>';
      return route.fulfill({ contentType: 'text/html', body });
    });

    await page.goto('https://dapp.test/');

    const allowed = (await page.evaluate(`(${requestAccounts})()`)) as {
      ok: boolean;
      result?: string[];
    };
    expect(allowed.ok).toBe(true);
    expect(allowed.result).toEqual([wallet.primaryAccount]);

    const embedded = page.frames().find((frame) => frame.url().startsWith('https://evil.test'));
    expect(embedded).toBeDefined();

    // The provider never installs out of scope, so the account address and
    // chain are not even readable there.
    expect(await embedded!.evaluate(() => 'ethereum' in window)).toBe(false);

    // And the bridge itself refuses the frame even if a script finds it.
    const blocked = (await embedded!.evaluate(`(${callBridgeDirectly})()`)) as {
      ok: boolean;
      code?: number;
      message?: string;
    };
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe(4100);
    expect(blocked.message).toContain('https://evil.test');
  });

  // `wallet` must be requested so the fixture injects the provider.
  test('refuses pages outside the allowlist entirely', async ({ page, wallet }) => {
    expect(wallet.primaryAccount).toMatch(/^0x/);
    await page.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>elsewhere</body></html>' }),
    );

    await page.goto('https://elsewhere.test/');

    expect(await page.evaluate(() => 'ethereum' in window)).toBe(false);
    const blocked = (await page.evaluate(`(${callBridgeDirectly})()`)) as { ok: boolean; code?: number };
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe(4100);
  });

  test('same-origin about:blank iframes inherit the parent origin and are served', async ({ page, wallet }) => {
    await page.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>dapp</body></html>' }),
    );

    await page.goto('https://dapp.test/');
    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
    });

    const blank = page.frames().find((frame) => frame !== page.mainFrame());
    expect(blank).toBeDefined();
    const served = (await blank!.evaluate(`(${callBridgeDirectly})()`)) as { ok: boolean };
    expect(served.ok).toBe(true);

    // The provider also installs there: window.origin inherits the parent.
    expect(await blank!.evaluate(() => 'ethereum' in window)).toBe(true);
    expect(
      (await blank!.evaluate(`(${requestAccounts})()`)) as { ok: boolean; result?: string[] },
    ).toEqual({ ok: true, result: [wallet.primaryAccount] });
  });
});

test('rejects malformed allowedOrigins entries at construction', async ({ page }) => {
  // 'localhost:3000' is the treacherous case: it PARSES as a URL with
  // protocol "localhost:" and origin "null", which would invert the
  // allowlist. Only http(s) entries are accepted.
  for (const entry of ['dapp.test', 'localhost:3000', 'file:///tmp/x']) {
    expect(
      () =>
        new MockWalletController(
          page,
          { request: async () => null },
          {
            accounts: ['0x000000000000000000000000000000000000beef'],
            chainId: 31337,
            allowedOrigins: [entry],
          },
        ),
      entry,
    ).toThrow(/not an http\(s\) URL or origin/);
  }
});

test('can reject the next signing request with a wallet-shaped error', async ({ page, wallet }) => {
  await page.setContent('<main>ready</main>');
  await wallet.simulateRejection('personal_sign');

  const rejection = await page.evaluate(async () => {
    try {
      await window.ethereum.request({
        method: 'personal_sign',
        params: ['0x68656c6c6f', window.ethereum.selectedAddress],
      });
      return null;
    } catch (error) {
      const walletError = error as { code: number; message: string };
      return {
        code: walletError.code,
        message: walletError.message,
      };
    }
  });

  expect(rejection).toEqual({
    code: 4001,
    message: 'User rejected the request.',
  });
});
