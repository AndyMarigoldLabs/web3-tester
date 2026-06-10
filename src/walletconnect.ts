import type { Page } from '@playwright/test';
import { toHex, type Address, type Hex } from 'viem';
import { serializeRpcError } from './errors.js';
import type { MockWalletController } from './mock-wallet-controller.js';

// All @walletconnect/* packages are OPTIONAL peers, loaded with dynamic
// imports inside create(). The types below are deliberately structural so
// the emitted d.ts never references @walletconnect/types — consumers who
// never import this subpath resolve nothing new.

export type WalletConnectMetadata = {
  name: string;
  description: string;
  url: string;
  icons: string[];
};

/** Structural IKeyValueStorage (getKeys/getEntries/getItem/setItem/removeItem). */
export type WalletConnectStorage = {
  getKeys(): Promise<string[]>;
  getEntries<T = unknown>(): Promise<[string, T][]>;
  getItem<T = unknown>(key: string): Promise<T | undefined>;
  setItem<T = unknown>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** The slice of SignClient this module drives — the raw client is exposed as an escape hatch. */
export type WalletConnectSignClient = {
  on(event: string, handler: (payload: never) => void): unknown;
  off?(event: string, handler: (payload: never) => void): unknown;
  removeListener?(event: string, handler: (payload: never) => void): unknown;
  pair(args: { uri: string }): Promise<unknown>;
  approve(args: { id: number; namespaces: Record<string, unknown> }): Promise<{
    topic: string;
    acknowledged: () => Promise<{ namespaces?: Record<string, unknown> } | undefined>;
  }>;
  reject(args: { id: number; reason: unknown }): Promise<void>;
  respond(args: { topic: string; response: unknown }): Promise<void>;
  emit(args: { topic: string; event: { name: string; data: unknown }; chainId: string }): Promise<void>;
  update(args: { topic: string; namespaces: Record<string, unknown> }): Promise<unknown>;
  disconnect(args: { topic: string; reason: unknown }): Promise<void>;
  core?: {
    relayer?: { transportClose?: () => Promise<void> };
    heartbeat?: { stop?: () => void };
  };
};

export type WalletConnectWalletOptions = {
  /**
   * The mock/live controller. EVERY session proposal and session_request
   * dispatches through its approval gating and transaction recording —
   * approveNext/autoApprove/holdNextRequest/simulateRejection govern WC
   * traffic exactly like injected traffic.
   */
  wallet: MockWalletController;
  /** Reown dashboard project id (the public relay requires one). */
  projectId: string;
  /** Defaults to the SDK default (wss://relay.walletconnect.org). */
  relayUrl?: string;
  /** Chains offered in the approved eip155 namespace. Default: [wallet.currentChainId]. */
  chains?: readonly (number | Hex)[];
  /** Namespace methods. Default: DEFAULT_WALLETCONNECT_METHODS. */
  methods?: readonly string[];
  /** Namespace events. Default: ['chainChanged', 'accountsChanged']. */
  events?: readonly string[];
  /** Peer metadata shown in the dapp UI. */
  metadata?: Partial<WalletConnectMetadata>;
  /**
   * Enforce the controller's allowedOrigins against the relay's
   * verifyContext origin. Default true. Note: when Verify reports
   * validation 'UNKNOWN' the origin derives from unattested proposer
   * metadata — a hostile dapp can spoof it, so origin scoping over WC is
   * weaker than the injected bridge. false dispatches with the controller's
   * bypassOriginCheck opt-out (approval gating still applies).
   */
  enforceOrigins?: boolean;
  /** SignClient storage override. Default: SDK in-memory (nothing on disk). */
  storage?: WalletConnectStorage;
};

export type WalletConnectSession = {
  topic: string;
  namespaces: Record<string, unknown>;
  peerMetadata: WalletConnectMetadata;
};

export type GetUriOptions = {
  /** Default 15_000. */
  timeoutMs?: number;
  /** Default 'wui-qr-code' (AppKit's QR element; its uri attribute is what Reown's own E2E suite reads). */
  selector?: string;
};

export const DEFAULT_WALLETCONNECT_METHODS: readonly string[] = [
  'eth_sendTransaction',
  'eth_sendRawTransaction',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_getPermissions',
  'wallet_requestPermissions',
  'wallet_watchAsset',
];

const DEFAULT_EVENTS: readonly string[] = ['chainChanged', 'accountsChanged'];

// Injectable so the missing-optional-peer hint is hermetically testable
// (the peers are devDependencies here, so they always resolve in-repo).
let loadModule: (specifier: string) => Promise<unknown> = (specifier) => import(specifier);

/** @internal Test hook: stub the dynamic importer; call with no args to restore. */
export const __setWalletConnectModuleLoader = (
  loader?: (specifier: string) => Promise<unknown>,
): void => {
  loadModule = loader ?? ((specifier) => import(specifier));
};

const parseCaipChainId = (caip: unknown): Hex | undefined => {
  const match = typeof caip === 'string' ? /^eip155:(\d+)$/.exec(caip) : null;
  return match ? toHex(BigInt(match[1]!)) : undefined;
};

const toCaipChainId = (chainId: Hex): string => `eip155:${Number(BigInt(chainId))}`;

type WcUtils = {
  parseUri(uri: string): { topic: string };
  buildApprovedNamespaces(args: {
    proposal: unknown;
    supportedNamespaces: Record<string, unknown>;
  }): Record<string, unknown>;
  getSdkError(code: string): unknown;
};

type SessionProposalEvent = {
  id: number;
  params?: {
    pairingTopic?: string;
    proposer?: { metadata?: WalletConnectMetadata };
    requiredNamespaces?: unknown;
    optionalNamespaces?: unknown;
  };
  verifyContext?: { verified?: { origin?: string; validation?: string } };
};

export type SessionRequestEvent = {
  id: number;
  topic: string;
  params: { request: { method: string; params?: unknown }; chainId: string };
  verifyContext?: { verified?: { origin?: string; validation?: string } };
};

export type SessionRequestResponse = {
  id: number;
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: string };
};

/**
 * The session_request loop, exported for hermetic tests: validates the CAIP
 * chain against the approved set, switches the wallet when an approved
 * non-active chain is requested (single-active-chain semantics, like a
 * mobile wallet), and dispatches through the controller's gating. Errors map
 * through serializeRpcError, so 4001/4100/4200/4902/-32602 cross the relay
 * verbatim.
 */
export const createSessionRequestHandler = (
  wallet: MockWalletController,
  config: { chains: readonly Hex[]; enforceOrigins: boolean },
  respond: (topic: string, response: SessionRequestResponse) => Promise<void>,
): ((event: SessionRequestEvent) => Promise<void>) => {
  return async (event) => {
    const { id, topic, params, verifyContext } = event;
    try {
      const chainId = parseCaipChainId(params.chainId);
      if (!chainId || !config.chains.includes(chainId)) {
        await respond(topic, {
          id,
          jsonrpc: '2.0',
          error: { code: 5100, message: 'Requested chain is not approved for this session.' },
        });
        return;
      }

      if (chainId !== wallet.currentChainId) {
        await wallet.switchNetwork(chainId);
      }

      const result = await wallet.handleExternalRequest(
        { method: params.request.method, params: params.request.params as never },
        config.enforceOrigins
          ? { origin: verifyContext?.verified?.origin }
          : { bypassOriginCheck: true },
      );
      await respond(topic, { id, jsonrpc: '2.0', result });
    } catch (error) {
      const serialized = serializeRpcError(error);
      await respond(topic, {
        id,
        jsonrpc: '2.0',
        error: {
          code: serialized.code,
          message: serialized.message,
          ...(typeof serialized.data === 'string' ? { data: serialized.data } : {}),
        },
      });
    }
  };
};

/**
 * Polls the AppKit/W3M modal for the pairing URI: Playwright CSS locators
 * pierce the shadow DOM, and AppKit's w3m-connecting-wc-qrcode renders
 * `<wui-qr-code uri=...>` as a real DOM attribute (the same contract
 * Reown's own laboratory tests read). For non-AppKit modals pass a
 * `selector` or use the connect() `getUri` hook.
 */
export async function getWalletConnectUri(page: Page, options: GetUriOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const selector = options.selector ?? 'wui-qr-code';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Bounded per attempt: getAttribute would otherwise auto-wait for the
    // element with Playwright's default timeout.
    const uri = await page
      .locator(selector)
      .first()
      .getAttribute('uri', { timeout: 250 })
      .catch(() => null);
    if (uri?.startsWith('wc:')) {
      return uri;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for a wc: pairing URI on "${selector}". ` +
      'For non-AppKit modals pass { selector } or supply a getUri(page) hook to connect().',
  );
}

export class WalletConnectWallet {
  /** Underlying SignClient — escape hatch for protocol-level access. */
  readonly client: WalletConnectSignClient;

  private readonly wallet: MockWalletController;
  private readonly utils: WcUtils;
  private chains: Hex[];
  private readonly methods: readonly string[];
  private readonly events: readonly string[];
  private readonly enforceOrigins: boolean;
  private readonly sessionList: WalletConnectSession[] = [];
  private readonly requestHandler: (event: SessionRequestEvent) => Promise<void>;
  private readonly deleteHandler: (event: { topic: string }) => void;
  private readonly unsubscribeProviderEvents: () => void;
  private closed = false;

  private constructor(
    client: WalletConnectSignClient,
    utils: WcUtils,
    options: WalletConnectWalletOptions,
  ) {
    this.client = client;
    this.utils = utils;
    this.wallet = options.wallet;
    this.chains = (options.chains ?? [options.wallet.currentChainId]).map((chainId) =>
      toHex(typeof chainId === 'number' ? chainId : BigInt(chainId)),
    );
    this.methods = options.methods ?? DEFAULT_WALLETCONNECT_METHODS;
    this.events = options.events ?? DEFAULT_EVENTS;
    this.enforceOrigins = options.enforceOrigins ?? true;

    // INVARIANT: never register a 'session_authenticate' listener. With zero
    // listeners, sign-client routes One-Click Auth (SIWE) dapps through the
    // wc_sessionPropose fallback — a plain session plus personal_sign —
    // which this wallet handles. Subscribing would suppress that fallback.
    this.requestHandler = createSessionRequestHandler(
      this.wallet,
      { chains: this.chains, enforceOrigins: this.enforceOrigins },
      (topic, response) => this.client.respond({ topic, response }),
    );
    client.on('session_request', this.requestHandler as never);

    this.deleteHandler = ({ topic }) => {
      const index = this.sessionList.findIndex((session) => session.topic === topic);
      if (index !== -1) {
        this.sessionList.splice(index, 1);
      }
    };
    client.on('session_delete', this.deleteHandler as never);

    this.unsubscribeProviderEvents = this.wallet.onProviderEvent((event, payload) => {
      void this.forwardProviderEvent(event, payload);
    });
  }

  /**
   * Async factory: dynamically imports the optional peers and throws an
   * install hint when they are missing.
   */
  static async create(options: WalletConnectWalletOptions): Promise<WalletConnectWallet> {
    let signClientModule: Record<string, unknown>;
    let utils: WcUtils;
    try {
      signClientModule = (await loadModule('@walletconnect/sign-client')) as Record<string, unknown>;
      utils = (await loadModule('@walletconnect/utils')) as WcUtils;
    } catch (error) {
      throw new Error(
        "The './walletconnect' module requires optional peer dependencies. " +
          'Install with: npm i -D @walletconnect/sign-client @walletconnect/utils @walletconnect/types',
        { cause: error },
      );
    }

    const SignClient = (signClientModule.SignClient ??
      signClientModule.default ??
      signClientModule) as {
      init(options: Record<string, unknown>): Promise<WalletConnectSignClient>;
    };

    const client = await SignClient.init({
      projectId: options.projectId,
      ...(options.relayUrl ? { relayUrl: options.relayUrl } : {}),
      metadata: {
        name: 'web3-tester Wallet',
        description: 'Headless WalletConnect wallet for E2E tests',
        url: 'https://github.com/AndyMarigoldLabs/web3-tester',
        icons: [],
        ...options.metadata,
      },
      // A request parked by holdNextRequest must not starve delivery of
      // subsequent session_requests (sign-client serializes them by default).
      signConfig: { disableRequestQueue: true },
      // Nothing touches disk: the SDK default would persist ./walletconnect.db.
      ...(options.storage ? { storage: options.storage } : { storageOptions: { database: ':memory:' } }),
    });

    return new WalletConnectWallet(client, utils, options);
  }

  get sessions(): readonly WalletConnectSession[] {
    return [...this.sessionList];
  }

  /**
   * Pairs with a wc: URI, gates the session proposal through the controller
   * (as a synthetic eth_requestAccounts — approveNext('eth_requestAccounts')
   * arms it; the match callback receives the proposal payload), builds the
   * approved namespaces, and settles the session.
   */
  async pair(options: { uri: string; timeoutMs?: number }): Promise<WalletConnectSession> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const { topic: pairingTopic } = this.utils.parseUri(options.uri);

    const proposal = await new Promise<SessionProposalEvent>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        (this.client.off ?? this.client.removeListener)?.call(
          this.client,
          'session_proposal',
          handler as never,
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for the session proposal.`));
      }, timeoutMs);
      const handler = (event: SessionProposalEvent) => {
        if (event.params?.pairingTopic && event.params.pairingTopic !== pairingTopic) {
          return;
        }
        cleanup();
        resolve(event);
      };
      this.client.on('session_proposal', handler as never);
      this.client.pair({ uri: options.uri }).catch((error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    // Gate the connect through the controller. Deny-by-default live mode,
    // simulateRejection, and holds all apply with zero new machinery.
    let accounts: readonly Address[];
    try {
      accounts = (await this.wallet.handleExternalRequest(
        {
          method: 'eth_requestAccounts',
          params: [
            {
              origin: proposal.verifyContext?.verified?.origin,
              proposer: proposal.params?.proposer?.metadata,
              requiredNamespaces: proposal.params?.requiredNamespaces,
              optionalNamespaces: proposal.params?.optionalNamespaces,
            },
          ],
        },
        this.enforceOrigins
          ? { origin: proposal.verifyContext?.verified?.origin }
          : { bypassOriginCheck: true },
      )) as readonly Address[];
    } catch (error) {
      await this.client
        .reject({ id: proposal.id, reason: this.utils.getSdkError('USER_REJECTED') })
        .catch(() => undefined);
      throw error;
    }

    let namespaces: Record<string, unknown>;
    try {
      namespaces = this.utils.buildApprovedNamespaces({
        proposal: proposal.params,
        supportedNamespaces: {
          eip155: {
            chains: this.chains.map(toCaipChainId),
            methods: [...this.methods],
            events: [...this.events],
            accounts: this.chains.flatMap((chainId) =>
              accounts.map((account) => `${toCaipChainId(chainId)}:${account}`),
            ),
          },
        },
      });
    } catch (error) {
      await this.client
        .reject({ id: proposal.id, reason: this.utils.getSdkError('UNSUPPORTED_CHAINS') })
        .catch(() => undefined);
      throw new Error(
        "Could not satisfy the dapp's requested namespaces — pass the chains it needs in " +
          `WalletConnectWalletOptions.chains. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const { topic, acknowledged } = await this.client.approve({ id: proposal.id, namespaces });
    const settled = await acknowledged();

    const session: WalletConnectSession = {
      topic,
      namespaces: settled?.namespaces ?? namespaces,
      peerMetadata:
        proposal.params?.proposer?.metadata ??
        ({ name: '', description: '', url: '', icons: [] } satisfies WalletConnectMetadata),
    };
    this.sessionList.push(session);
    return session;
  }

  /** Convenience: extract the URI from the dapp's modal, then pair(). */
  async connect(
    page: Page,
    options: GetUriOptions & { getUri?: (page: Page) => Promise<string> } = {},
  ): Promise<WalletConnectSession> {
    const uri = options.getUri ? await options.getUri(page) : await getWalletConnectUri(page, options);
    return this.pair({ uri, timeoutMs: options.timeoutMs });
  }

  /** Wallet-initiated disconnect; all sessions when topic is omitted. */
  async disconnect(topic?: string): Promise<void> {
    const targets = this.sessionList.filter((session) => !topic || session.topic === topic);
    for (const session of targets) {
      await this.client
        .disconnect({ topic: session.topic, reason: this.utils.getSdkError('USER_DISCONNECTED') })
        .catch(() => undefined);
      this.deleteHandler({ topic: session.topic });
    }
  }

  /**
   * Best-effort teardown: disconnect sessions (5s cap), unsubscribe the
   * controller listener, close the relay transport, stop the heartbeat.
   * Always call in finally / fixture teardown.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    await Promise.race([
      this.disconnect(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]).catch(() => undefined);

    this.unsubscribeProviderEvents();
    (this.client.off ?? this.client.removeListener)?.call(
      this.client,
      'session_request',
      this.requestHandler as never,
    );
    (this.client.off ?? this.client.removeListener)?.call(
      this.client,
      'session_delete',
      this.deleteHandler as never,
    );

    await this.client.core?.relayer?.transportClose?.().catch(() => undefined);
    this.client.core?.heartbeat?.stop?.();
  }

  // Relay round-trips happen here, OFF the controller's await path — the
  // onProviderEvent dispatch is fire-and-forget, so a dead relay can never
  // hang wallet.switchNetwork()/disconnect().
  private async forwardProviderEvent(event: string, payload: unknown): Promise<void> {
    for (const session of [...this.sessionList]) {
      try {
        if (event === 'chainChanged') {
          const chainId = payload as Hex;
          if (!this.chains.includes(chainId)) {
            // Extend the session namespace first (MetaMask-mobile behavior).
            this.chains = [...this.chains, chainId];
            const namespaces = session.namespaces as {
              eip155?: { chains?: string[]; accounts?: string[]; [key: string]: unknown };
            };
            const eip155 = namespaces.eip155;
            if (eip155) {
              const caip = toCaipChainId(chainId);
              const extended = {
                ...namespaces,
                eip155: {
                  ...eip155,
                  chains: [...(eip155.chains ?? []), caip],
                  accounts: [
                    ...(eip155.accounts ?? []),
                    ...this.wallet.currentAccounts.map((account) => `${caip}:${account}`),
                  ],
                },
              };
              await this.client.update({ topic: session.topic, namespaces: extended });
              session.namespaces = extended;
            }
          }
          await this.client.emit({
            topic: session.topic,
            event: { name: 'chainChanged', data: Number(BigInt(chainId)) },
            chainId: toCaipChainId(chainId),
          });
        } else if (event === 'accountsChanged') {
          await this.client.emit({
            topic: session.topic,
            event: { name: 'accountsChanged', data: payload },
            chainId: toCaipChainId(this.wallet.currentChainId),
          });
        } else if (event === 'disconnect') {
          await this.client
            .disconnect({ topic: session.topic, reason: this.utils.getSdkError('USER_DISCONNECTED') })
            .catch(() => undefined);
          this.deleteHandler({ topic: session.topic });
        }
      } catch {
        // Relay errors must never break wallet state transitions.
      }
    }
  }
}
