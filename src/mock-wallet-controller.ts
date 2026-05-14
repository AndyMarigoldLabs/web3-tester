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

const permissionResponse = [
  {
    parentCapability: 'eth_accounts',
    caveats: [],
  },
];

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

export class MockWalletController {
  private accounts: Address[];
  private chainId: Hex;
  private connected: boolean;
  private approveRequests: boolean;
  private rejectionQueue: RejectionRule[] = [];

  constructor(
    private readonly page: Page,
    private readonly rpcClient: RpcClient,
    options: MockWalletControllerOptions,
  ) {
    this.accounts = [...options.accounts];
    this.chainId = normalizeChainId(options.chainId);
    this.connected = options.connected ?? true;
    this.approveRequests = options.autoApprove ?? true;

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
    await this.page.exposeFunction(
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

    const config: MockWalletConfig = {
      accounts: this.accounts,
      autoApprove: this.approveRequests,
      chainId: this.chainId,
      connected: this.connected,
      providers: this.providerInfos,
    };

    const providerScript = buildInjectedProviderScript(config);
    await this.page.addInitScript(providerScript);
    await this.page.evaluate(providerScript);
  }

  autoApprove(enabled = true): void {
    this.approveRequests = enabled;
  }

  async simulateRejection(
    methods: string | readonly string[] = [...SIGNING_METHODS],
    message = 'User rejected the request.',
  ): Promise<void> {
    this.rejectionQueue.push({
      methods: typeof methods === 'string' ? [methods] : methods,
      message,
    });
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
    await this.emit('chainChanged', this.chainId);
  }

  private async emit(event: string, payload: unknown): Promise<void> {
    await this.page.evaluate(
      ({ emitter, eventName, eventPayload }) => {
        const maybeEmitter = window[emitter as keyof Window];
        if (typeof maybeEmitter === 'function') {
          maybeEmitter(eventName, eventPayload);
        }
      },
      { emitter: emitterName, eventName: event, eventPayload: payload },
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

  private assertUserApproved(method: string): void {
    const forcedRejection = this.consumeRejection(method);
    if (forcedRejection) {
      throw providerError(4001, forcedRejection.message ?? 'User rejected the request.');
    }

    if (!this.approveRequests && (SIGNING_METHODS.has(method) || method === 'eth_requestAccounts')) {
      throw providerError(4001, 'User rejected the request.');
    }
  }

  private async handleRpcRequest(request: JsonRpcRequest): Promise<unknown> {
    const { method } = request;
    const params = normalizeParams(request.params);

    switch (method) {
      case 'eth_accounts':
        return this.connected ? this.accounts : [];

      case 'eth_requestAccounts':
        this.assertUserApproved(method);
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
        return this.connected ? permissionResponse : [];

      case 'wallet_requestPermissions':
        this.assertUserApproved(method);
        this.connected = true;
        await this.emit('accountsChanged', this.accounts);
        return permissionResponse;

      case 'wallet_switchEthereumChain': {
        this.assertUserApproved(method);
        const requestedChain = params[0] as { chainId?: Hex } | undefined;
        if (!requestedChain?.chainId) {
          throw providerError(-32602, 'wallet_switchEthereumChain requires a chainId.');
        }
        await this.switchNetwork(requestedChain.chainId);
        return null;
      }

      case 'wallet_addEthereumChain':
        this.assertUserApproved(method);
        return null;

      case 'wallet_watchAsset':
        this.assertUserApproved(method);
        return true;

      case 'metamask_getProviderState':
        return {
          accounts: this.connected ? this.accounts : [],
          chainId: this.chainId,
          isUnlocked: true,
          networkVersion: String(Number(BigInt(this.chainId))),
        };

      case 'eth_sendTransaction': {
        this.assertUserApproved(method);
        const transaction = { ...(params[0] as Record<string, unknown> | undefined) };
        transaction.from ??= this.primaryAccount;
        return this.rpcClient.request({
          method,
          params: [transaction],
        });
      }

      case 'eth_sign':
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
      case 'personal_sign':
        this.assertUserApproved(method);
        return this.rpcClient.request({ method, params });

      default:
        return this.rpcClient.request({ method, params });
    }
  }
}
