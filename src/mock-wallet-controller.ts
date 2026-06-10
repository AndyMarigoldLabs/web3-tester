import type { Frame, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { http, toHex, type Address, type Hex } from 'viem';
import { providerError, serializeRpcError } from './errors.js';
import {
  buildInjectedProviderScript,
  emitterName,
  rpcBridgeName,
} from './injected-provider.js';
import type {
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResponseEnvelope,
  MockWalletConfig,
  RpcClient,
  WalletProviderInfo,
} from './types.js';

export type RejectionRule = {
  methods?: readonly string[];
  message?: string;
};

export type HeldRequest = {
  method: string;
  params: readonly unknown[];
  approve: () => void;
  reject: (message?: string) => void;
};

export type SentTransactionRecord = {
  hash: Hex;
  /** The wallet's active chain when the transaction was sent. */
  chainId: Hex;
  from?: Address;
  to?: Hex;
  data?: Hex;
  value?: string;
};

/** A chain backend: any RpcClient, or an http(s) RPC URL string. */
export type ChainBackend = RpcClient | string;

export type AtomicCapabilityStatus = 'supported' | 'ready' | 'unsupported';

export type Eip5792Options = {
  /** Master switch. false = legacy wallet: all four methods throw 4200. Default: true. */
  enabled?: boolean;
  /** Atomic capability advertised for backed chains. Default: 'supported'. */
  atomic?: AtomicCapabilityStatus;
  /** Extra/override capability objects merged per chain ('0x0' = cross-chain per spec). */
  capabilities?: Record<Hex, Record<string, unknown>>;
  /** Batches with more calls throw 5740. Default: 100. */
  maxCallsPerBatch?: number;
};

export type CallsBatchRecord = {
  id: Hex;
  chainId: Hex;
  from: Address;
  version: '2.0.0';
  /** Execution mode actually used (the spec requires it to reflect reality). */
  atomic: boolean;
  /** What the dapp requested. */
  atomicRequired: boolean;
  capabilities?: Record<string, unknown>;
  calls: readonly { to?: Hex; data?: Hex; value?: Hex }[];
  /** Submitted hashes in call order (rolled-back hashes included). */
  txHashes: readonly Hex[];
  /**
   * 'atomic-rollback': something landed and everything was reverted (500).
   * 'nothing-landed': no call made it onchain (400). Otherwise the status is
   * computed from receipts.
   */
  failure?: 'atomic-rollback' | 'nothing-landed';
};

export type HttpRpcClientOptions = {
  /** Request timeout in ms. Defaults to viem's transport default (10s). */
  timeout?: number;
  /** Retry count. Defaults to 0 so dead endpoints fail deterministically. */
  retryCount?: number;
};

/**
 * Adapter: EIP-1193 RpcClient over a plain JSON-RPC URL (viem http
 * transport). URL-backed chains serve reads, eth_sendRawTransaction, and
 * dapp-side flows; node-side signing (personal_sign, eth_sendTransaction)
 * needs a node that signs — back those chains with Anvil or a
 * PrivateKeyRpcClient instead.
 */
export function httpRpcClient(url: string, options: HttpRpcClientOptions = {}): RpcClient {
  const transport = http(url, {
    retryCount: options.retryCount ?? 0,
    timeout: options.timeout,
  })({});
  return {
    request: (request: JsonRpcRequest) => transport.request(request as never),
  };
}

export type MockWalletControllerOptions = {
  accounts: readonly Address[];
  chainId: number | Hex;
  /**
   * Additional chains the wallet can switch to, keyed by chain id (number or
   * 0x-hex). The constructor's rpcClient remains the backend for `chainId`;
   * listing `chainId` here too is a construction error. Forwarded calls
   * route to the active chain's backend; a known-but-unbacked chain throws
   * 4901 (EIP-1193 "Chain Disconnected").
   */
  chains?: Readonly<Record<number | Hex, ChainBackend>>;
  /**
   * Honor dapp-supplied rpcUrls[0] in wallet_addEthereumChain: the URL is
   * probed (its eth_chainId must match, per EIP-3085) and registered as the
   * chain's backend. Default false: the chain id is registered (so the
   * 4902 -> add -> switch flow completes) but forwarded calls on it throw
   * 4901 until a backend is registered via `chains` or addChain(). Never
   * enable this for wallets fronting a real key.
   */
  trustDappRpcUrls?: boolean;
  /**
   * EIP-5792 support (wallet_getCapabilities/sendCalls/getCallsStatus/
   * showCallsStatus). Enabled by default, like 2026 MetaMask; pass false for
   * a legacy wallet that answers 4200.
   */
  eip5792?: boolean | Eip5792Options;
  providerInfo?: Partial<WalletProviderInfo>;
  additionalProviders?: readonly Partial<WalletProviderInfo>[];
  autoApprove?: boolean;
  connected?: boolean;
  /**
   * When set, only frames whose origin matches an entry (URL or origin
   * string) can reach the wallet; everything else gets a 4100 error. Leave
   * unset to serve every frame, like a real extension.
   */
  allowedOrigins?: readonly string[];
};

const DEFAULT_PROVIDER_INFO: WalletProviderInfo = {
  uuid: '00000000-0000-4000-8000-000000000001',
  name: 'Mock Wallet',
  icon:
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%23111827"/><path d="M17 34h30v14H17z" fill="%2338bdf8"/><path d="M20 18h24v16H20z" fill="%23f59e0b"/><circle cx="43" cy="41" r="3" fill="%23111827"/></svg>',
  rdns: 'dev.invisible-wallet.mock',
};

const defaultAdditionalProviderInfo = (index: number): WalletProviderInfo => ({
  uuid: `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
  name: `Mock Wallet ${index + 2}`,
  icon: DEFAULT_PROVIDER_INFO.icon,
  rdns: `dev.invisible-wallet.mock.${index + 2}`,
});

const SIGNING_METHODS = new Set([
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  // A batch is a spend: 4100 while disconnected, approval-gated, covered by
  // the default simulateRejection() set.
  'wallet_sendCalls',
]);

// Methods that open a wallet prompt in a real wallet but do not sign.
const PROMPT_METHODS = new Set([
  'wallet_addEthereumChain',
  'wallet_requestPermissions',
  'wallet_switchEthereumChain',
  'wallet_watchAsset',
]);

const APPROVAL_GATED_METHODS = new Set([
  ...SIGNING_METHODS,
  ...PROMPT_METHODS,
  'eth_requestAccounts',
  // Broadcasts someone else's signed bytes — still a spend the user must
  // approve, and it must not slip through the unguarded default forward.
  'eth_sendRawTransaction',
]);

const normalizeParams = (params: JsonRpcParams): unknown[] => {
  if (params === undefined) {
    return [];
  }

  if (Array.isArray(params)) {
    return [...params];
  }

  return [params];
};

// Canonical (lowercase, minimal) hex so '0xAA36A7', '0x0aa36a7', and
// 11155111 all map to one chain-registry key. Config/test-side input throws
// a plain Error on garbage; dapp params go through parseDappChainId instead.
const normalizeChainId = (chainId: number | Hex | string): Hex => {
  try {
    return toHex(typeof chainId === 'number' ? chainId : BigInt(chainId));
  } catch {
    throw new Error(`Invalid chain id "${String(chainId)}".`);
  }
};

const parseDappChainId = (chainId: unknown): Hex => {
  if (typeof chainId !== 'string' || !chainId.startsWith('0x')) {
    throw providerError(-32602, 'Expected a 0x-prefixed chainId.');
  }
  try {
    return toHex(BigInt(chainId));
  } catch {
    throw providerError(-32602, `Invalid chainId "${chainId}".`);
  }
};

// Bounded eth_chainId probe used when trustDappRpcUrls wires up a
// dapp-supplied RPC URL — a hung endpoint must not stall the dapp's promise.
const probeChainId = async (url: string, timeoutMs = 5_000): Promise<Hex> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json()) as { result?: unknown };
  if (typeof body.result !== 'string') {
    throw new Error(`No eth_chainId result from ${url}.`);
  }
  return toHex(BigInt(body.result));
};

const toOrigin = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return 'null';
  }
};

// Frames whose URL carries no origin of its own; in the browser they inherit
// the parent's (or opener's) origin.
const isBlankFrameUrl = (url: string): boolean =>
  url === '' || url === 'about:blank' || url === 'about:srcdoc';

// The browser-effective origin of the calling frame: blank frames inherit
// from the nearest non-blank ancestor, blank popups from their opener.
const resolveFrameOrigin = async (source: { page: Page; frame: Frame }): Promise<string> => {
  let frame: Frame | null = source.frame;
  while (frame && isBlankFrameUrl(frame.url())) {
    frame = frame.parentFrame();
  }
  if (frame) {
    return toOrigin(frame.url());
  }

  const opener = await source.page.opener().catch(() => null);
  return opener ? toOrigin(opener.mainFrame().url()) : 'null';
};

type HoldRule = {
  methods?: readonly string[];
  intercept: (method: string, params: readonly unknown[]) => Promise<void>;
};

type ApprovalRule = {
  methods?: readonly string[];
  match?: (method: string, params: readonly unknown[]) => boolean;
};

export class MockWalletController {
  private accounts: Address[];
  private chainId: Hex;
  private connected: boolean;
  private approveRequests: boolean;
  private rejectionQueue: RejectionRule[] = [];
  private holdQueue: HoldRule[] = [];
  private approvalQueue: ApprovalRule[] = [];
  private readonly knownChainIds = new Set<Hex>();
  private readonly chainBackends = new Map<Hex, RpcClient>();
  private readonly trustDappRpcUrls: boolean;
  private readonly allowedOrigins?: readonly string[];
  private readonly providerEventListeners = new Set<
    (event: string, payload: unknown) => void
  >();
  // Promise-chain mutex: forwarded sends (and, later, batch execution inside
  // a snapshot window) must not interleave — exposeBinding handlers run
  // concurrently.
  private sendQueue: Promise<unknown> = Promise.resolve();
  private nodeAccountsCache?: Set<string>;
  private readonly eip5792: Required<Pick<Eip5792Options, 'enabled' | 'maxCallsPerBatch'>> &
    Eip5792Options;
  private atomicStatus: AtomicCapabilityStatus;
  private upgradeRejectionArmed = false;
  private readonly callBatches = new Map<Hex, CallsBatchRecord>();

  /** Every accepted wallet_sendCalls batch, for test assertions. */
  readonly sentCallBatches: CallsBatchRecord[] = [];
  /** Ids the page passed to wallet_showCallsStatus (a headless no-op). */
  readonly shownCallsStatusIds: Hex[] = [];

  readonly sentTransactions: Hex[] = [];
  readonly sentTransactionRequests: SentTransactionRecord[] = [];

  constructor(
    private readonly page: Page,
    private readonly rpcClient: RpcClient,
    options: MockWalletControllerOptions,
  ) {
    this.accounts = [...options.accounts];
    this.chainId = normalizeChainId(options.chainId);
    this.connected = options.connected ?? true;
    this.approveRequests = options.autoApprove ?? true;
    this.trustDappRpcUrls = options.trustDappRpcUrls ?? false;
    const eip5792 = typeof options.eip5792 === 'boolean' ? { enabled: options.eip5792 } : (options.eip5792 ?? {});
    this.eip5792 = {
      enabled: eip5792.enabled ?? true,
      maxCallsPerBatch: eip5792.maxCallsPerBatch ?? 100,
      atomic: eip5792.atomic,
      capabilities: eip5792.capabilities,
    };
    this.atomicStatus = this.eip5792.atomic ?? 'supported';
    this.knownChainIds.add(this.chainId);
    this.chainBackends.set(this.chainId, rpcClient);
    for (const [key, backend] of Object.entries(options.chains ?? {})) {
      const id = normalizeChainId(key);
      if (id === this.chainId) {
        throw new Error(
          `chains must not list the default chainId ${id} — the constructor's rpcClient is its backend.`,
        );
      }
      this.chainBackends.set(id, typeof backend === 'string' ? httpRpcClient(backend) : backend);
      this.knownChainIds.add(id);
    }
    this.allowedOrigins = options.allowedOrigins?.map((entry) => {
      // Strictly http(s): a scheme-less "localhost:3000" parses as protocol
      // "localhost:" with origin "null", which would silently allowlist every
      // null-origin frame and block the intended host.
      let origin: string | undefined;
      try {
        const url = new URL(entry);
        origin = /^https?:$/.test(url.protocol) ? url.origin : undefined;
      } catch {
        origin = undefined;
      }

      if (!origin || origin === 'null') {
        throw new Error(
          `allowedOrigins entry "${entry}" is not an http(s) URL or origin (expected e.g. "https://app.example.com").`,
        );
      }

      return origin;
    });

    if (this.accounts.length === 0) {
      throw new Error('MockWalletController requires at least one account.');
    }

    const primaryProviderInfo = {
      ...DEFAULT_PROVIDER_INFO,
      ...options.providerInfo,
    };

    this.providerInfos = [
      primaryProviderInfo,
      ...(options.additionalProviders ?? []).map((provider, index) => ({
        ...defaultAdditionalProviderInfo(index),
        ...provider,
      })),
    ];

    this.providerInfo = primaryProviderInfo;
  }

  readonly providerInfo: WalletProviderInfo;
  readonly providerInfos: readonly WalletProviderInfo[];

  get primaryAccount(): Address {
    return this.accounts[0]!;
  }

  /** Current account list; index 0 is the selected account. */
  get currentAccounts(): readonly Address[] {
    return [...this.accounts];
  }

  get currentChainId(): Hex {
    return this.chainId;
  }

  /** Chain ids that currently have an RPC backend, canonical hex. */
  get backedChainIds(): readonly Hex[] {
    return [...this.chainBackends.keys()];
  }

  /**
   * Test-side chain registration (Synpress addNetwork analogue): registers
   * the backend and marks the chain known — no approval gate, no probe, and
   * re-registration overwrites (tests may rewire).
   */
  addChain(chainId: number | Hex, backend: ChainBackend): void {
    const id = normalizeChainId(chainId);
    this.chainBackends.set(id, typeof backend === 'string' ? httpRpcClient(backend) : backend);
    this.knownChainIds.add(id);
  }

  /**
   * Dispatch a request arriving from a non-injected transport (e.g. a
   * WalletConnect session). Approval gating applies exactly as for injected
   * requests. When allowedOrigins is configured, `context.origin` is
   * enforced; an absent origin counts as "null" and is refused.
   * `bypassOriginCheck` is the deliberate opt-out for transports that cannot
   * attest origins — approval gating still applies.
   */
  async handleExternalRequest(
    request: JsonRpcRequest,
    context: { origin?: string; bypassOriginCheck?: boolean } = {},
  ): Promise<unknown> {
    if (this.allowedOrigins && !context.bypassOriginCheck) {
      this.assertOriginAllowed(context.origin !== undefined ? toOrigin(context.origin) : 'null');
    }
    return this.handleRpcRequest(request);
  }

  /**
   * Observe provider events (chainChanged, accountsChanged, connect,
   * disconnect) node-side — the hook non-injected transports use to push
   * session events. Dispatch is fire-and-forget; listener errors are
   * swallowed. Returns an unsubscribe function.
   */
  onProviderEvent(listener: (event: string, payload: unknown) => void): () => void {
    this.providerEventListeners.add(listener);
    return () => {
      this.providerEventListeners.delete(listener);
    };
  }

  async injectMockProvider(): Promise<void> {
    // Fail fast on misconfigured accounts before any page plumbing exists —
    // a bad fixture config surfaces here with a readable message instead of
    // dying later inside the dapp with anvil's opaque -32602.
    await this.assertAccountsKnownToNode(this.accounts, 'injectMockProvider');

    // Context-level injection so pages the dapp opens itself (window.open,
    // target=_blank flows) get the provider too.
    const context = this.page.context();

    try {
      // exposeBinding rather than exposeFunction so the handler can see which
      // frame is calling and enforce allowedOrigins.
      await context.exposeBinding(
        rpcBridgeName,
        async (
          source: { page: Page; frame: Frame },
          request: JsonRpcRequest,
        ): Promise<JsonRpcResponseEnvelope> => {
          try {
            if (this.allowedOrigins) {
              this.assertOriginAllowed(await resolveFrameOrigin(source));
            }
            const result = await this.handleRpcRequest(request);
            return { ok: true, result };
          } catch (error) {
            return { ok: false, error: serializeRpcError(error) };
          }
        },
      );
    } catch (error) {
      if (error instanceof Error && /already registered/i.test(error.message)) {
        throw new Error(
          'A mock wallet provider is already injected into this browser context. Create one MockWalletController per context.',
          { cause: error },
        );
      }
      throw error;
    }

    const config: MockWalletConfig = {
      accounts: this.accounts,
      autoApprove: this.approveRequests,
      chainId: this.chainId,
      connected: this.connected,
      providers: this.providerInfos,
      allowedOrigins: this.allowedOrigins,
    };

    const providerScript = buildInjectedProviderScript(config);
    await context.addInitScript(providerScript);
    await Promise.all(
      context.pages().map((page) => page.evaluate(providerScript).catch(() => undefined)),
    );
  }

  autoApprove(enabled = true): void {
    this.approveRequests = enabled;
  }

  /**
   * One-shot: the next atomicRequired wallet_sendCalls while the atomic
   * capability is 'ready' throws 5750 (user rejected the EOA upgrade)
   * instead of upgrading to 'supported'.
   */
  simulateAtomicUpgradeRejection(): void {
    this.upgradeRejectionArmed = true;
  }

  /**
   * Arms approval for the next matching request while autoApprove is off —
   * the explicit per-call grant for real-key (live) wallets. Queued
   * rejections and holds still take precedence.
   *
   * A grant without `match` approves whatever matching request arrives first
   * and never expires, so any page script (including a third-party include on
   * an allowed origin) can race the dapp for it. Pass `match` to bind the
   * grant to the expected payload, or use holdNextRequest() to inspect the
   * request before deciding.
   */
  approveNext(
    methods?: string | readonly string[],
    match?: (method: string, params: readonly unknown[]) => boolean,
  ): void {
    this.approvalQueue.push({
      methods: typeof methods === 'string' ? [methods] : methods,
      match,
    });
  }

  async simulateRejection(
    methods: string | readonly string[] = [...APPROVAL_GATED_METHODS],
    message = 'User rejected the request.',
  ): Promise<void> {
    this.rejectionQueue.push({
      methods: typeof methods === 'string' ? [methods] : methods,
      message,
    });
  }

  /**
   * Intercepts the next matching request and keeps it pending until the test
   * approves or rejects it — for asserting "confirm in your wallet" UI states.
   * Resolves once the page actually issues the request.
   */
  holdNextRequest(methods?: string | readonly string[]): Promise<HeldRequest> {
    return new Promise<HeldRequest>((resolveHeld) => {
      this.holdQueue.push({
        methods: typeof methods === 'string' ? [methods] : methods,
        intercept: (method, params) =>
          new Promise<void>((approve, rejectGate) => {
            resolveHeld({
              method,
              params,
              approve: () => approve(),
              reject: (message = 'User rejected the request.') =>
                rejectGate(providerError(4001, message)),
            });
          }),
      });
    });
  }

  /**
   * Resolves with the hash of the next transaction the page submits after
   * this call. Invoke before triggering the dapp action, then await it.
   */
  async waitForNextTransaction(options: { timeoutMs?: number } = {}): Promise<Hex> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const baseline = this.sentTransactions.length;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.sentTransactions.length > baseline) {
        return this.sentTransactions[baseline]!;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Timed out after ${timeoutMs}ms waiting for the page to submit a transaction.`);
  }

  /**
   * Replaces the account set (and reconnects a disconnected wallet — unlike
   * switchAccount, which only reorders). Accounts are validated against the
   * backing node's eth_accounts; pass { allowUnknownAccounts: true } only
   * for custom RpcClients whose account list the probe cannot see.
   */
  async setAccounts(
    accounts: readonly Address[],
    options: { allowUnknownAccounts?: boolean } = {},
  ): Promise<void> {
    if (accounts.length === 0) {
      throw new Error('setAccounts requires at least one account. Use disconnect() to expose no accounts.');
    }

    if (!options.allowUnknownAccounts) {
      await this.assertAccountsKnownToNode(accounts, 'setAccounts');
    }

    this.accounts = [...accounts];
    this.connected = true;
    await this.emit('accountsChanged', this.accounts);
  }

  /**
   * Re-selects one of the wallet's existing accounts: moves it to index 0
   * (MetaMask orders eth_accounts most-recently-selected first) and emits
   * accountsChanged with the reordered array. No event when it is already
   * selected, and — unlike setAccounts — no reconnect while disconnected:
   * the reorder stays internal until the wallet reconnects.
   */
  async switchAccount(address: Address): Promise<void> {
    const index = this.accounts.findIndex(
      (account) => account.toLowerCase() === address.toLowerCase(),
    );
    if (index === -1) {
      throw new Error(
        `switchAccount: "${address}" is not one of the wallet's accounts. Use setAccounts() to change the set.`,
      );
    }
    if (index === 0) {
      return;
    }

    const [selected] = this.accounts.splice(index, 1);
    this.accounts.unshift(selected!);
    if (this.connected) {
      await this.emit('accountsChanged', this.accounts);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.emit('accountsChanged', []);
    await this.emit('disconnect', { code: 4900, message: 'Mock wallet disconnected.' });
  }

  async reconnect(): Promise<void> {
    this.connected = true;
    await this.emit('connect', { chainId: this.chainId });
    await this.emit('accountsChanged', this.accounts);
  }

  async switchNetwork(chainId: number | Hex): Promise<void> {
    const normalized = normalizeChainId(chainId);
    // A test-driven switch counts as the user adding/approving the chain.
    this.knownChainIds.add(normalized);
    if (normalized === this.chainId) {
      // MetaMask emits no chainChanged for a same-chain switch.
      return;
    }
    this.chainId = normalized;
    await this.emit('chainChanged', this.chainId);
  }

  private async emit(event: string, payload: unknown): Promise<void> {
    for (const listener of this.providerEventListeners) {
      queueMicrotask(() => {
        try {
          listener(event, payload);
        } catch {
          // Listener errors must never break wallet state transitions.
        }
      });
    }

    await Promise.all(
      this.page.context().pages().map((page) =>
        page
          .evaluate(
            ({ emitter, eventName, eventPayload }) => {
              const maybeEmitter = window[emitter as keyof Window];
              if (typeof maybeEmitter === 'function') {
                maybeEmitter(eventName, eventPayload);
              }
            },
            { emitter: emitterName, eventName: event, eventPayload: payload },
          )
          .catch(() => undefined),
      ),
    );
  }

  // The single seam every forwarded request routes through: a known-but-
  // unbacked chain fails loudly here (EIP-1193 4901 "Chain Disconnected")
  // instead of silently hitting the wrong node.
  private clientForChain(chainId: Hex): RpcClient {
    const client = this.chainBackends.get(chainId);
    if (!client) {
      throw providerError(
        4901,
        `The wallet is not connected to chain "${chainId}". It was added without an RPC backend — ` +
          'pass it in MockWalletControllerOptions.chains, call wallet.addChain(chainId, clientOrUrl), ' +
          'or enable trustDappRpcUrls.',
      );
    }
    return client;
  }

  private get activeRpcClient(): RpcClient {
    return this.clientForChain(this.chainId);
  }

  private enqueueSend<T>(task: () => Promise<T>): Promise<T> {
    const run = this.sendQueue.then(task, task);
    this.sendQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private assertEip5792Enabled(method: string): void {
    if (!this.eip5792.enabled) {
      // Legacy-wallet posture: identical to the unknown wallet_* default.
      throw providerError(4200, `The mock wallet does not support the method "${method}".`);
    }
  }

  private batchForId(id: unknown): CallsBatchRecord {
    const key = typeof id === 'string' ? (id as Hex) : undefined;
    const record = key ? this.callBatches.get(key) : undefined;
    if (!record) {
      throw providerError(5730, `Unknown bundle id "${String(id)}".`);
    }
    return record;
  }

  private async handleSendCalls(params: readonly unknown[]): Promise<{ id: Hex }> {
    const request = params[0] as
      | {
          version?: unknown;
          id?: unknown;
          from?: unknown;
          chainId?: unknown;
          atomicRequired?: unknown;
          calls?: unknown;
          capabilities?: Record<string, unknown>;
        }
      | undefined;

    // Validation order per spec + MetaMask: params (-32602) -> account
    // (4100) -> chain (5710) -> size (5740) -> id (5720) -> capabilities
    // (5700) -> atomicity (5760/5750) -> approval (4001) -> execution.
    if (!request || typeof request !== 'object') {
      throw providerError(-32602, 'wallet_sendCalls requires a request object.');
    }
    if (request.version !== '2.0.0') {
      // The spec assigns no code; MetaMask requires 2.0.0.
      throw providerError(-32602, 'wallet_sendCalls requires version "2.0.0".');
    }
    if (typeof request.atomicRequired !== 'boolean') {
      throw providerError(-32602, 'wallet_sendCalls requires a boolean atomicRequired.');
    }
    const calls = request.calls;
    if (!Array.isArray(calls) || calls.length === 0 || calls.some((call) => !call || typeof call !== 'object')) {
      throw providerError(-32602, 'wallet_sendCalls requires a non-empty calls array.');
    }
    const chainId = parseDappChainId(request.chainId);

    const from = (request.from as Address | undefined) ?? this.primaryAccount;
    if (!this.accounts.some((account) => account.toLowerCase() === String(from).toLowerCase())) {
      throw providerError(
        4100,
        `The requested account ${String(from)} has not been authorized by the user.`,
      );
    }

    // MetaMask-faithful: the batch must target the active, backed network.
    if (chainId !== this.chainId || !this.chainBackends.has(chainId)) {
      throw providerError(
        5710,
        `Chain ${chainId} is not the wallet's active chain (${this.chainId}).`,
      );
    }

    if (calls.length > this.eip5792.maxCallsPerBatch) {
      throw providerError(
        5740,
        `Batch of ${calls.length} calls exceeds the limit of ${this.eip5792.maxCallsPerBatch}.`,
      );
    }

    let id: Hex;
    if (request.id !== undefined) {
      if (
        typeof request.id !== 'string' ||
        !/^0x[0-9a-fA-F]*$/.test(request.id) ||
        request.id.length > 8194
      ) {
        throw providerError(-32602, 'wallet_sendCalls id must be a 0x-hex string of at most 4096 bytes.');
      }
      id = request.id as Hex;
      if (this.callBatches.has(id)) {
        throw providerError(5720, `Duplicate bundle id "${id}".`);
      }
    } else {
      id = `0x${randomBytes(32).toString('hex')}` as Hex;
    }

    const advertised = new Set([
      'atomic',
      ...Object.keys(this.eip5792.capabilities?.[chainId] ?? {}),
      ...Object.keys(this.eip5792.capabilities?.['0x0' as Hex] ?? {}),
    ]);
    const capabilityEntries: Array<[string, unknown]> = [
      ...Object.entries(request.capabilities ?? {}),
      ...calls.flatMap((call) =>
        Object.entries((call as { capabilities?: Record<string, unknown> }).capabilities ?? {}),
      ),
    ];
    for (const [name, value] of capabilityEntries) {
      const optional = (value as { optional?: unknown } | undefined)?.optional === true;
      if (!advertised.has(name) && !optional) {
        throw providerError(5700, `Capability "${name}" is not supported on chain ${chainId}.`);
      }
    }

    if (request.atomicRequired && this.atomicStatus === 'unsupported') {
      throw providerError(5760, 'This wallet cannot execute the batch atomically.');
    }
    if (request.atomicRequired && this.atomicStatus === 'ready' && this.upgradeRejectionArmed) {
      this.upgradeRejectionArmed = false;
      throw providerError(5750, 'The user rejected the account upgrade required for atomic execution.');
    }

    // ONE approval gates the whole batch — a single approveNext arms all N
    // calls (in live mode that is N real transactions; see docs).
    await this.assertUserApproved('wallet_sendCalls', params);

    const atomic = request.atomicRequired || this.atomicStatus !== 'unsupported';
    const client = this.clientForChain(chainId);
    const batchCalls = (calls as Array<{ to?: Hex; data?: Hex; value?: Hex }>).map((call) => ({
      to: call.to,
      data: call.data,
      value: call.value,
    }));

    const record: CallsBatchRecord = {
      id,
      chainId,
      from: from as Address,
      version: '2.0.0',
      atomic,
      atomicRequired: request.atomicRequired,
      capabilities: request.capabilities,
      calls: batchCalls,
      txHashes: [],
      failure: undefined,
    };

    // The whole batch executes inside the send mutex so a concurrent
    // page-initiated transaction can never be swallowed by the batch's
    // snapshot/revert window.
    await this.enqueueSend(() => this.executeBatch(record, client));

    this.callBatches.set(id, record);
    this.sentCallBatches.push(record);

    if (
      atomic &&
      record.failure === undefined &&
      request.atomicRequired &&
      this.atomicStatus === 'ready'
    ) {
      // Emulates MetaMask's EOA -> smart-account upgrade on first use.
      this.atomicStatus = 'supported';
    }

    return { id };
  }

  // Receipt-status-checked execution: anvil MINES reverting transactions
  // with status 0x0 instead of erroring (no submission failure to catch), so
  // each call's receipt is fetched synchronously under automine and a 0x0
  // status triggers the rollback. With blockTime > 0 receipts are not
  // synchronously available and atomic mode only rolls back submission-time
  // failures — documented limitation.
  private async executeBatch(record: CallsBatchRecord, client: RpcClient): Promise<void> {
    const txHashes: Hex[] = [];
    let landed = 0;
    let failed = false;

    let snapshotId: unknown;
    if (record.atomic) {
      try {
        snapshotId = await client.request({ method: 'evm_snapshot', params: [] });
      } catch {
        throw providerError(
          -32603,
          'Atomic execution needs an anvil-backed chain (evm_snapshot failed). ' +
            "Configure eip5792: { atomic: 'unsupported' } for live chains.",
        );
      }
    }

    for (const call of record.calls) {
      const transaction: Record<string, unknown> = { from: record.from };
      if (call.to !== undefined) transaction.to = call.to;
      if (call.data !== undefined) transaction.data = call.data;
      if (call.value !== undefined) transaction.value = call.value;

      let hash: Hex;
      try {
        hash = (await client.request({
          method: 'eth_sendTransaction',
          params: [transaction],
        })) as Hex;
      } catch {
        failed = true;
        break;
      }

      txHashes.push(hash);
      this.sentTransactions.push(hash);
      this.sentTransactionRequests.push({
        hash,
        chainId: record.chainId,
        from: record.from,
        to: call.to,
        data: call.data,
        value: call.value !== undefined ? String(call.value) : undefined,
      });

      const receipt = (await client
        .request({ method: 'eth_getTransactionReceipt', params: [hash] })
        .catch(() => null)) as { status?: Hex } | null;
      if (receipt) {
        landed += 1;
        if (receipt.status === '0x0') {
          failed = true;
          break;
        }
      }
    }

    record.txHashes = txHashes;

    if (failed && record.atomic) {
      await client
        .request({ method: 'evm_revert', params: [snapshotId] })
        .catch(() => undefined);
      record.failure = landed > 0 ? 'atomic-rollback' : 'nothing-landed';
    } else if (failed && landed === 0) {
      record.failure = 'nothing-landed';
    }
    // Non-atomic with something landed: the status is computed from receipts
    // (600 mixed / 500 all-reverted) in wallet_getCallsStatus.
  }

  private async buildCallsStatus(record: CallsBatchRecord): Promise<Record<string, unknown>> {
    const base = {
      version: '2.0.0',
      id: record.id,
      chainId: record.chainId,
      atomic: record.atomic,
    };

    if (record.failure === 'atomic-rollback') {
      // The rolled-back transactions no longer exist on-chain; receipts are
      // deliberately omitted (divergence from real MetaMask, which would
      // return one reverted 7702 receipt — documented).
      return { ...base, status: 500 };
    }
    if (record.failure === 'nothing-landed') {
      return { ...base, status: 400, receipts: [] };
    }

    const client = this.clientForChain(record.chainId);
    const receipts = await Promise.all(
      record.txHashes.map(
        (hash) =>
          client
            .request({ method: 'eth_getTransactionReceipt', params: [hash] })
            .catch(() => null) as Promise<Record<string, unknown> | null>,
      ),
    );

    if (receipts.some((receipt) => receipt === null)) {
      return { ...base, status: 100 };
    }

    const projected = receipts.map((receipt) => ({
      logs: ((receipt!.logs as Array<Record<string, unknown>> | undefined) ?? []).map((log) => ({
        address: log.address,
        data: log.data,
        topics: log.topics,
      })),
      status: receipt!.status,
      blockHash: receipt!.blockHash,
      blockNumber: receipt!.blockNumber,
      gasUsed: receipt!.gasUsed,
      transactionHash: receipt!.transactionHash,
    }));

    const reverted = projected.filter((receipt) => receipt.status === '0x0').length;
    const status =
      reverted === 0 ? 200 : reverted === projected.length ? 500 : 600;

    return { ...base, status, receipts: projected };
  }

  private consumeRule<T extends { methods?: readonly string[] }>(
    queue: T[],
    method: string,
  ): T | undefined {
    const index = queue.findIndex(
      (rule) => !rule.methods || rule.methods.includes(method),
    );

    if (index === -1) {
      return undefined;
    }

    const [rule] = queue.splice(index, 1);
    return rule;
  }

  // Bounded probe of the backing node's account list. Returns undefined when
  // the node cannot answer (throw, timeout, non-array, empty) — validation
  // then fails open, which is what keeps live RPC endpoints and custom
  // RpcClients usable.
  private async fetchNodeAccounts(): Promise<Set<string> | undefined> {
    const TIMED_OUT = Symbol('probe-timeout');
    try {
      const result = await Promise.race([
        this.rpcClient.request({ method: 'eth_accounts', params: [] }),
        new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), 2_500)),
      ]);
      if (result === TIMED_OUT || !Array.isArray(result) || result.length === 0) {
        return undefined;
      }
      return new Set(result.map((account) => String(account).toLowerCase()));
    } catch {
      return undefined;
    }
  }

  // Membership in the node's eth_accounts means the node will ACCEPT sends
  // from the account — not that it can sign messages for it: anvil lists
  // impersonated accounts too (their personal_sign still fails node-side
  // with -32602). Re-probes on a miss so accounts impersonated after the
  // first probe validate without any escape hatch. Best-effort under
  // anvil --auto-impersonate, where every address is accepted.
  private async assertAccountsKnownToNode(
    accounts: readonly Address[],
    operation: string,
  ): Promise<void> {
    let known = this.nodeAccountsCache ?? (await this.fetchNodeAccounts());
    if (!known) {
      return;
    }
    this.nodeAccountsCache = known;

    const unknownIn = (set: Set<string>) =>
      accounts.filter((account) => !set.has(account.toLowerCase()));

    if (unknownIn(known).length > 0) {
      known = await this.fetchNodeAccounts();
      if (!known) {
        return;
      }
      this.nodeAccountsCache = known;
    }

    const unknown = unknownIn(known);
    if (unknown.length > 0) {
      throw new Error(
        `${operation}: account(s) ${unknown.join(', ')} are not known to the backing node ` +
          `(${known.size} node accounts). Use addresses from chain.accounts(), or ` +
          'chain.impersonateAccount(address) for send-only flows (impersonated accounts can send ' +
          'transactions, but personal_sign/typed-data still fail node-side with -32602). For custom ' +
          'RpcClients that cannot answer eth_accounts, pass { allowUnknownAccounts: true } to setAccounts.',
      );
    }
  }

  private assertOriginAllowed(origin: string): void {
    if (!this.allowedOrigins) {
      return;
    }

    if (!this.allowedOrigins.includes(origin)) {
      throw providerError(
        4100,
        `The wallet is not available to origin "${origin}" (allowedOrigins: ${this.allowedOrigins.join(', ')}).`,
      );
    }
  }

  private async assertUserApproved(method: string, params: readonly unknown[]): Promise<void> {
    const hold = this.consumeRule(this.holdQueue, method);
    if (hold) {
      // The test's explicit approve()/reject() decision is authoritative;
      // it bypasses autoApprove and queued rejection rules.
      await hold.intercept(method, params);
      return;
    }

    const forcedRejection = this.consumeRule(this.rejectionQueue, method);
    if (forcedRejection) {
      throw providerError(4001, forcedRejection.message ?? 'User rejected the request.');
    }

    const armedIndex = this.approvalQueue.findIndex(
      (rule) =>
        (!rule.methods || rule.methods.includes(method)) &&
        (!rule.match || rule.match(method, params)),
    );
    if (armedIndex !== -1) {
      this.approvalQueue.splice(armedIndex, 1);
      return;
    }

    if (!this.approveRequests && APPROVAL_GATED_METHODS.has(method)) {
      throw providerError(4001, 'User rejected the request.');
    }
  }

  private permissionResponse() {
    return [
      {
        parentCapability: 'eth_accounts',
        caveats: [{ type: 'restrictReturnedAccounts', value: [...this.accounts] }],
      },
    ];
  }

  private async handleRpcRequest(request: JsonRpcRequest): Promise<unknown> {
    const { method } = request;
    const params = normalizeParams(request.params);

    if (!this.connected && SIGNING_METHODS.has(method)) {
      throw providerError(
        4100,
        'The requested account and/or method has not been authorized by the user.',
      );
    }

    switch (method) {
      case 'eth_accounts':
        return this.connected ? this.accounts : [];

      case 'eth_requestAccounts':
        await this.assertUserApproved(method, params);
        if (!this.connected) {
          this.connected = true;
          await this.emit('connect', { chainId: this.chainId });
          await this.emit('accountsChanged', this.accounts);
        }
        return this.accounts;

      case 'eth_chainId':
        return this.chainId;

      case 'net_version':
        return String(Number(BigInt(this.chainId)));

      case 'wallet_getPermissions':
        return this.connected ? this.permissionResponse() : [];

      case 'wallet_requestPermissions':
        await this.assertUserApproved(method, params);
        this.connected = true;
        await this.emit('accountsChanged', this.accounts);
        return this.permissionResponse();

      case 'wallet_revokePermissions':
        this.connected = false;
        await this.emit('accountsChanged', []);
        return null;

      // Per-handler order, library-wide: param validation (-32602) -> state
      // checks (4902) -> approval -> execution. Real MetaMask returns 4902
      // for an unknown chain without ever showing a prompt.
      case 'wallet_switchEthereumChain': {
        const requestedChain = params[0] as { chainId?: unknown } | undefined;
        if (!requestedChain?.chainId) {
          throw providerError(-32602, 'wallet_switchEthereumChain requires a chainId.');
        }
        const normalized = parseDappChainId(requestedChain.chainId);
        if (!this.knownChainIds.has(normalized)) {
          throw providerError(
            4902,
            `Unrecognized chain ID "${normalized}". Try adding the chain using wallet_addEthereumChain first.`,
          );
        }
        await this.assertUserApproved(method, params);
        await this.switchNetwork(normalized);
        return null;
      }

      case 'wallet_addEthereumChain': {
        const definition = params[0] as { chainId?: unknown; rpcUrls?: unknown } | undefined;
        if (typeof definition?.chainId !== 'string' || !definition.chainId.startsWith('0x')) {
          throw providerError(-32602, 'wallet_addEthereumChain requires a 0x-prefixed chainId.');
        }
        const normalized = parseDappChainId(definition.chainId);
        // EIP-3085: the wallet MUST reject when rpcUrls is missing, empty, or
        // contains invalid URLs (MetaMask does too; wagmi always sends them).
        const rpcUrls = definition.rpcUrls;
        const urlsValid =
          Array.isArray(rpcUrls) &&
          rpcUrls.length > 0 &&
          rpcUrls.every((url) => {
            if (typeof url !== 'string') {
              return false;
            }
            try {
              new URL(url);
              return true;
            } catch {
              return false;
            }
          });
        if (!urlsValid) {
          throw providerError(
            -32602,
            'wallet_addEthereumChain requires rpcUrls: a non-empty array of valid URLs.',
          );
        }

        await this.assertUserApproved(method, params);

        // First registration wins for dapp adds: re-adding a backed chain is
        // a no-op switch, like MetaMask.
        if (this.trustDappRpcUrls && !this.chainBackends.has(normalized)) {
          const [url] = rpcUrls as string[];
          // http(s) only; we deliberately allow http: (localhost Anvil is the
          // dominant test case), deviating from EIP-3085's https-only rule.
          if (!/^https?:$/.test(new URL(url!).protocol)) {
            throw providerError(-32602, `rpcUrls[0] "${url}" is not an http(s) URL.`);
          }
          let reported: Hex;
          try {
            reported = await probeChainId(url!);
          } catch {
            throw providerError(
              -32602,
              `rpcUrls[0] "${url}" is unreachable or did not answer eth_chainId.`,
            );
          }
          if (reported !== normalized) {
            // EIP-3085: reject when the URL's eth_chainId does not match.
            throw providerError(
              -32602,
              `rpcUrls[0] reports chain id ${reported} but ${normalized} was requested.`,
            );
          }
          this.chainBackends.set(normalized, httpRpcClient(url!));
        }

        this.knownChainIds.add(normalized);
        // MetaMask offers to switch after adding; the mock approves that too
        // (wagmi verifies eth_chainId === target after an add and hard-fails
        // if the wallet did not switch). switchNetwork skips the chainChanged
        // emit when the chain is already active.
        await this.switchNetwork(normalized);
        return null;
      }

      case 'wallet_watchAsset':
        await this.assertUserApproved(method, params);
        return true;

      case 'wallet_getCapabilities': {
        this.assertEip5792Enabled(method);
        // Spec privacy rule: only answer for the connected wallet's accounts.
        const [address, chainIdFilter] = params as [unknown, unknown];
        const requested = typeof address === 'string' ? address.toLowerCase() : '';
        if (
          !this.connected ||
          !this.accounts.some((account) => account.toLowerCase() === requested)
        ) {
          throw providerError(
            4100,
            'The requested account and/or method has not been authorized by the user.',
          );
        }

        const response: Record<string, Record<string, unknown>> = {};
        for (const chainId of this.chainBackends.keys()) {
          response[chainId] = { atomic: { status: this.atomicStatus } };
        }
        for (const [key, value] of Object.entries(this.eip5792.capabilities ?? {})) {
          const chainId = key === '0x0' ? ('0x0' as Hex) : normalizeChainId(key);
          response[chainId] = { ...response[chainId], ...value };
        }

        if (Array.isArray(chainIdFilter)) {
          const wanted = new Set(chainIdFilter.map((id) => parseDappChainId(id)));
          for (const key of Object.keys(response)) {
            if (key !== '0x0' && !wanted.has(key as Hex)) {
              delete response[key];
            }
          }
        }
        return response;
      }

      case 'wallet_sendCalls': {
        this.assertEip5792Enabled(method);
        return this.handleSendCalls(params);
      }

      case 'wallet_getCallsStatus': {
        this.assertEip5792Enabled(method);
        const record = this.batchForId(params[0]);
        return this.buildCallsStatus(record);
      }

      case 'wallet_showCallsStatus': {
        this.assertEip5792Enabled(method);
        const record = this.batchForId(params[0]);
        this.shownCallsStatusIds.push(record.id);
        return null;
      }

      case 'metamask_getProviderState':
        return {
          accounts: this.connected ? this.accounts : [],
          chainId: this.chainId,
          isUnlocked: true,
          networkVersion: String(Number(BigInt(this.chainId))),
        };

      case 'eth_sendTransaction': {
        const transaction = { ...(params[0] as Record<string, unknown> | undefined) };
        transaction.from ??= this.primaryAccount;
        // MetaMask rejects sends from accounts the dapp is not authorized
        // for; anvil would happily sign with ANY unlocked dev account.
        const from = String(transaction.from).toLowerCase();
        if (!this.accounts.some((account) => account.toLowerCase() === from)) {
          throw providerError(
            4100,
            `The requested account ${String(transaction.from)} has not been authorized by the user.`,
          );
        }
        await this.assertUserApproved(method, params);
        // Capture the routed chain at approval time so a concurrent switch
        // cannot redirect a queued send.
        const chainId = this.chainId;
        const client = this.activeRpcClient;
        const hash = (await this.enqueueSend(() =>
          client.request({ method, params: [transaction] }),
        )) as Hex;
        this.sentTransactions.push(hash);
        this.sentTransactionRequests.push({
          hash,
          chainId,
          from: transaction.from as Address | undefined,
          to: transaction.to as Hex | undefined,
          data: transaction.data as Hex | undefined,
          value: transaction.value !== undefined ? String(transaction.value) : undefined,
        });
        return hash;
      }

      case 'eth_sendRawTransaction': {
        await this.assertUserApproved(method, params);
        const chainId = this.chainId;
        const client = this.activeRpcClient;
        const hash = (await this.enqueueSend(() => client.request({ method, params }))) as Hex;
        this.sentTransactions.push(hash);
        this.sentTransactionRequests.push({ hash, chainId });
        return hash;
      }

      case 'eth_signTypedData':
        throw providerError(
          4200,
          'eth_signTypedData (legacy v1) is not supported by the mock wallet. Use eth_signTypedData_v4.',
        );

      case 'eth_signTypedData_v3':
        // Anvil only implements v4; v3 payloads (no arrays or recursive
        // structs) hash identically under v4 rules.
        await this.assertUserApproved(method, params);
        return this.activeRpcClient.request({ method: 'eth_signTypedData_v4', params });

      case 'eth_sign':
      case 'eth_signTypedData_v4':
      case 'personal_sign':
        await this.assertUserApproved(method, params);
        return this.activeRpcClient.request({ method, params });

      default:
        // Unknown wallet-namespace methods are the wallet's responsibility;
        // forwarding them to the node would leak a confusing -32601.
        if (method.startsWith('wallet_')) {
          throw providerError(
            4200,
            `The mock wallet does not support the method "${method}".`,
          );
        }
        return this.activeRpcClient.request({ method, params });
    }
  }
}
