import type { Page } from '@playwright/test';
import { toHex, type Address, type Hex } from 'viem';
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
  from?: Address;
  to?: Hex;
  data?: Hex;
  value?: string;
};

export type MockWalletControllerOptions = {
  accounts: readonly Address[];
  chainId: number | Hex;
  providerInfo?: Partial<WalletProviderInfo>;
  additionalProviders?: readonly Partial<WalletProviderInfo>[];
  autoApprove?: boolean;
  connected?: boolean;
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

const normalizeChainId = (chainId: number | Hex): Hex =>
  typeof chainId === 'number' ? toHex(chainId) : chainId;

type HoldRule = {
  methods?: readonly string[];
  intercept: (method: string, params: readonly unknown[]) => Promise<void>;
};

export class MockWalletController {
  private accounts: Address[];
  private chainId: Hex;
  private connected: boolean;
  private approveRequests: boolean;
  private rejectionQueue: RejectionRule[] = [];
  private holdQueue: HoldRule[] = [];
  private readonly knownChainIds = new Set<Hex>();

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
    this.knownChainIds.add(this.chainId);

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

  get currentChainId(): Hex {
    return this.chainId;
  }

  async injectMockProvider(): Promise<void> {
    // Context-level injection so pages the dapp opens itself (window.open,
    // target=_blank flows) get the provider too.
    const context = this.page.context();

    try {
      await context.exposeFunction(
        rpcBridgeName,
        async (request: JsonRpcRequest): Promise<JsonRpcResponseEnvelope> => {
          try {
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

  async setAccounts(accounts: readonly Address[]): Promise<void> {
    if (accounts.length === 0) {
      throw new Error('setAccounts requires at least one account. Use disconnect() to expose no accounts.');
    }

    this.accounts = [...accounts];
    this.connected = true;
    await this.emit('accountsChanged', this.accounts);
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
    this.chainId = normalizeChainId(chainId);
    // A test-driven switch counts as the user adding/approving the chain.
    this.knownChainIds.add(this.chainId);
    await this.emit('chainChanged', this.chainId);
  }

  private async emit(event: string, payload: unknown): Promise<void> {
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

  private consumeRejection(method: string): RejectionRule | undefined {
    const index = this.rejectionQueue.findIndex(
      (rule) => !rule.methods || rule.methods.includes(method),
    );

    if (index === -1) {
      return undefined;
    }

    const [rule] = this.rejectionQueue.splice(index, 1);
    return rule;
  }

  private consumeHold(method: string): HoldRule | undefined {
    const index = this.holdQueue.findIndex(
      (rule) => !rule.methods || rule.methods.includes(method),
    );

    if (index === -1) {
      return undefined;
    }

    const [rule] = this.holdQueue.splice(index, 1);
    return rule;
  }

  private async assertUserApproved(method: string, params: readonly unknown[]): Promise<void> {
    const hold = this.consumeHold(method);
    if (hold) {
      // The test's explicit approve()/reject() decision is authoritative;
      // it bypasses autoApprove and queued rejection rules.
      await hold.intercept(method, params);
      return;
    }

    const forcedRejection = this.consumeRejection(method);
    if (forcedRejection) {
      throw providerError(4001, forcedRejection.message ?? 'User rejected the request.');
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

      case 'wallet_switchEthereumChain': {
        await this.assertUserApproved(method, params);
        const requestedChain = params[0] as { chainId?: Hex } | undefined;
        if (!requestedChain?.chainId) {
          throw providerError(-32602, 'wallet_switchEthereumChain requires a chainId.');
        }
        const normalized = normalizeChainId(requestedChain.chainId);
        if (!this.knownChainIds.has(normalized)) {
          throw providerError(
            4902,
            `Unrecognized chain ID "${normalized}". Try adding the chain using wallet_addEthereumChain first.`,
          );
        }
        await this.switchNetwork(normalized);
        return null;
      }

      case 'wallet_addEthereumChain': {
        await this.assertUserApproved(method, params);
        const definition = params[0] as { chainId?: Hex } | undefined;
        if (typeof definition?.chainId !== 'string' || !definition.chainId.startsWith('0x')) {
          throw providerError(-32602, 'wallet_addEthereumChain requires a 0x-prefixed chainId.');
        }
        const normalized = normalizeChainId(definition.chainId);
        this.knownChainIds.add(normalized);
        // MetaMask offers to switch after adding; the mock approves that too.
        if (normalized !== this.chainId) {
          await this.switchNetwork(normalized);
        }
        return null;
      }

      case 'wallet_watchAsset':
        await this.assertUserApproved(method, params);
        return true;

      case 'metamask_getProviderState':
        return {
          accounts: this.connected ? this.accounts : [],
          chainId: this.chainId,
          isUnlocked: true,
          networkVersion: String(Number(BigInt(this.chainId))),
        };

      case 'eth_sendTransaction': {
        await this.assertUserApproved(method, params);
        const transaction = { ...(params[0] as Record<string, unknown> | undefined) };
        transaction.from ??= this.primaryAccount;
        const hash = (await this.rpcClient.request({
          method,
          params: [transaction],
        })) as Hex;
        this.sentTransactions.push(hash);
        this.sentTransactionRequests.push({
          hash,
          from: transaction.from as Address | undefined,
          to: transaction.to as Hex | undefined,
          data: transaction.data as Hex | undefined,
          value: transaction.value !== undefined ? String(transaction.value) : undefined,
        });
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
        return this.rpcClient.request({ method: 'eth_signTypedData_v4', params });

      case 'eth_sign':
      case 'eth_signTypedData_v4':
      case 'personal_sign':
        await this.assertUserApproved(method, params);
        return this.rpcClient.request({ method, params });

      default:
        // Unknown wallet-namespace methods are the wallet's responsibility;
        // forwarding them to the node would leak a confusing -32601.
        if (method.startsWith('wallet_')) {
          throw providerError(
            4200,
            `The mock wallet does not support the method "${method}".`,
          );
        }
        return this.rpcClient.request({ method, params });
    }
  }
}
