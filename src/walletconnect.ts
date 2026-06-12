import type { Locator, Page } from '@playwright/test';
import { toHex, type Address, type Hex } from 'viem';
import { serializeRpcError } from './errors.js';
import type { MockWalletController } from './mock-wallet-controller.js';
import type { JsonRpcParams } from './types.js';
import {
  createWalletPersona,
  walletConnectMetadataForPersona,
  type WalletPersona,
  type WalletPersonaInput,
} from './wallet-personas.js';

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
export type WalletConnectEventMap = {
  session_request: SessionRequestEvent;
  session_proposal: SessionProposalEvent;
  session_authenticate: SessionAuthenticateEvent;
  session_delete: { topic: string };
};

type WalletConnectEventHandler<Event extends keyof WalletConnectEventMap> = (
  payload: WalletConnectEventMap[Event],
) => void | Promise<void>;

export type WalletConnectSignClient = {
  on<Event extends keyof WalletConnectEventMap>(
    event: Event,
    handler: WalletConnectEventHandler<Event>,
  ): unknown;
  off?<Event extends keyof WalletConnectEventMap>(
    event: Event,
    handler: WalletConnectEventHandler<Event>,
  ): unknown;
  removeListener?<Event extends keyof WalletConnectEventMap>(
    event: Event,
    handler: WalletConnectEventHandler<Event>,
  ): unknown;
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
  formatAuthMessage(args: { request: Record<string, unknown>; iss: string }): string;
  approveSessionAuthenticate(args: { id: number; auths: readonly WalletConnectCacao[] }): Promise<{
    session?: {
      topic: string;
      namespaces?: Record<string, unknown>;
      peer?: { metadata?: WalletConnectMetadata };
    };
  }>;
  rejectSessionAuthenticate(args: { id: number; reason: unknown }): Promise<void>;
  core?: {
    relayer?: { transportClose?: () => Promise<void> };
  heartbeat?: { stop?: () => void };
  };
};

const removeWalletConnectListener = <Event extends keyof WalletConnectEventMap>(
  client: WalletConnectSignClient,
  event: Event,
  handler: WalletConnectEventHandler<Event>,
): void => {
  if (client.off) {
    client.off(event, handler);
    return;
  }
  client.removeListener?.(event, handler);
};

export type WalletConnectSolanaOptions = {
  /** CAIP-2 Solana chains to approve. Defaults to the persona/default Solana provider chains. */
  chains?: readonly string[];
  /** Base58 public key used in approved accounts and mock signatures. */
  publicKey?: string;
  /** Solana namespace methods. Default: DEFAULT_WALLETCONNECT_SOLANA_METHODS. */
  methods?: readonly string[];
  /** Solana namespace events. Default: ['accountsChanged']. */
  events?: readonly string[];
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
  /** Wallet persona used for SignClient peer metadata. */
  persona?: WalletPersona | WalletPersonaInput;
  /**
   * EVM/eip155 namespace support. Defaults to false for personas with
   * `evm: false`, true otherwise.
   */
  evm?: boolean;
  /**
   * Solana namespace support. Defaults to the persona's Solana provider when
   * present; pass false to suppress it or an object to override chains/key/methods.
   */
  solana?: boolean | WalletConnectSolanaOptions;
  /**
   * Handle WalletConnect One-Click Auth / SIWE requests through
   * session_authenticate. Default true. Set false to rely on sign-client's
   * fallback session-proposal + personal_sign path.
   */
  sessionAuthenticate?: boolean;
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
  /**
   * WalletConnect Core storage/global-cache prefix. Tests that create both a
   * dapp SignClient and wallet SignClient in one process should give each
   * peer a distinct prefix. Default: a unique web3-tester wallet prefix.
   */
  customStoragePrefix?: string;
};

export type WalletConnectSession = {
  topic: string;
  namespaces: Record<string, unknown>;
  peerMetadata: WalletConnectMetadata;
};

export type GetUriOptions = {
  /** Default 15_000. */
  timeoutMs?: number;
  /**
   * Legacy single selector. Defaults to 'wui-qr-code' (AppKit's QR element;
   * its uri attribute is what Reown's own E2E suite reads).
   */
  selector?: string;
  /** Additional URI-bearing elements to probe. */
  selectors?: readonly string[];
  /** Attributes read from selector matches. Default: uri, data-uri, href, value. */
  attributes?: readonly string[];
  /** Text/value-bearing elements to probe. Default: textarea, input, code, pre, [data-wc-uri]. */
  textSelectors?: readonly string[];
  /** Legacy single copy control selector. */
  copyButtonSelector?: string;
  /** Copy controls to click before reading navigator.clipboard. */
  copyButtonSelectors?: readonly string[];
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
  'wallet_getCapabilities',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'wallet_showCallsStatus',
];

export const DEFAULT_WALLETCONNECT_COINBASE_METHODS: readonly string[] = [
  'wallet_connect',
  'wallet_addSubAccount',
  'wallet_getSubAccounts',
  'coinbase_fetchPermissions',
  'coinbase_fetchPermission',
];

const DEFAULT_EVENTS: readonly string[] = ['chainChanged', 'accountsChanged'];

export const DEFAULT_WALLETCONNECT_SOLANA_METHODS: readonly string[] = [
  'solana_getAccounts',
  'solana_requestAccounts',
  'solana_signIn',
  'solana_signAllTransactions',
  'solana_signAndSendAllTransactions',
  'solana_signAndSendTransaction',
  'solana_signMessage',
  'solana_signTransaction',
];

const DEFAULT_SOLANA_EVENTS: readonly string[] = ['accountsChanged'];
const DEFAULT_SOLANA_CHAINS: readonly string[] = [
  'solana:mainnet',
  'solana:devnet',
  'solana:testnet',
];

// Injectable so the missing-optional-peer hint is hermetically testable
// (the peers are devDependencies here, so they always resolve in-repo).
let loadModule: (specifier: string) => Promise<unknown> = (specifier) => import(specifier);
let walletConnectStoragePrefixCounter = 0;

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

const parseSolanaCaipChainId = (caip: unknown): string | undefined =>
  typeof caip === 'string' && /^solana:[a-z0-9-]+$/i.test(caip) ? caip : undefined;

const toCaipChainId = (chainId: Hex): string => `eip155:${Number(BigInt(chainId))}`;

const isAddressString = (value: unknown): value is Address =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

const eip155AccountsFor = (
  chains: readonly string[],
  accounts: readonly Address[],
): string[] => chains.flatMap((chainId) => accounts.map((account) => `${chainId}:${account}`));

const arraysEqual = (left: readonly string[] = [], right: readonly string[] = []): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export type WalletConnectSolanaNamespace = {
  chains: readonly string[];
  publicKey: string;
  methods: readonly string[];
  events: readonly string[];
};

const bytesFrom = (input: unknown): number[] => {
  if (input instanceof Uint8Array) return [...input];
  if (input instanceof ArrayBuffer) return [...new Uint8Array(input)];
  if (ArrayBuffer.isView(input)) {
    return [...new Uint8Array(input.buffer, input.byteOffset, input.byteLength)];
  }
  if (Array.isArray(input)) return input.map((value) => Number(value) & 255);
  if (typeof input === 'string') return [...new TextEncoder().encode(input)];
  return [...new TextEncoder().encode(JSON.stringify(input ?? null))];
};

const deterministicSignature = (publicKey: string, payload: unknown): Uint8Array => {
  const seed = [...new TextEncoder().encode(publicKey), ...bytesFrom(payload)];
  const signature = new Uint8Array(64);
  for (let index = 0; index < signature.length; index += 1) {
    const a = seed[index % seed.length] ?? 0;
    const b = seed[(index * 7 + 13) % seed.length] ?? 0;
    signature[index] = (a + b + index * 17) & 255;
  }
  return signature;
};

const base58Encode = (input: Uint8Array): string => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const next = digits[index]! * 256 + carry;
      digits[index] = next % 58;
      carry = Math.floor(next / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (const byte of input) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => alphabet[digit])
    .join('');
};

const signatureFor = (publicKey: string, payload: unknown): string =>
  base58Encode(deterministicSignature(publicKey, payload));

const resolveSolanaOptions = (
  option: boolean | WalletConnectSolanaOptions | undefined,
  persona: WalletPersona | undefined,
): WalletConnectSolanaNamespace | undefined => {
  if (option === false) {
    return undefined;
  }

  const input = typeof option === 'object' ? option : {};
  const personaSolana = persona?.solana;
  if (!personaSolana && option !== true && option === undefined) {
    return undefined;
  }

  return {
    chains: input.chains ?? personaSolana?.chains ?? DEFAULT_SOLANA_CHAINS,
    publicKey:
      input.publicKey ??
      personaSolana?.publicKey ??
      '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
    methods: input.methods ?? DEFAULT_WALLETCONNECT_SOLANA_METHODS,
    events: input.events ?? DEFAULT_SOLANA_EVENTS,
  };
};

type WcUtils = {
  parseUri(uri: string): { topic: string };
  buildApprovedNamespaces(args: {
    proposal: unknown;
    supportedNamespaces: Record<string, unknown>;
  }): Record<string, unknown>;
  buildAuthObject(
    requestPayload: Record<string, unknown>,
    signature: { t: 'eip191' | 'eip1271'; s: string; m?: string },
    iss: string,
  ): WalletConnectCacao;
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

export type WalletConnectCacao = {
  h: { t: 'caip122' };
  p: Record<string, unknown> & { iss: string };
  s: { t: 'eip191' | 'eip1271'; s: string; m?: string };
};

export type SessionAuthenticateEvent = {
  id: number;
  topic: string;
  params: {
    requester?: { metadata?: WalletConnectMetadata };
    authPayload: Record<string, unknown> & { chains?: unknown };
    expiryTimestamp?: number;
  };
  verifyContext?: { verified?: { origin?: string; validation?: string } };
};

const rpcError = (code: number, message: string): Error & { code: number } => {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
};

const normalizeObjectParams = (params: unknown): Record<string, unknown> => {
  const candidate = Array.isArray(params) ? params[0] : params;
  return candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
};

const normalizeJsonRpcParams = (params: unknown): JsonRpcParams => {
  if (params === undefined || Array.isArray(params)) return params;
  if (params && typeof params === 'object') return params as Record<string, unknown>;
  return [params];
};

const assertSolanaPubkey = (params: Record<string, unknown>, publicKey: string): void => {
  const requested = params.pubkey;
  if (requested !== undefined && requested !== publicKey) {
    throw rpcError(4100, `The requested Solana account ${String(requested)} is not authorized.`);
  }
};

const solanaAccountsResult = (solana: WalletConnectSolanaNamespace): { pubkey: string }[] => [
  { pubkey: solana.publicKey },
];

const buildSolanaSignInMessage = (
  publicKey: string,
  input: Record<string, unknown> = {},
): Uint8Array => {
  const address = input.address ?? publicKey;
  const domain = input.domain ?? 'localhost';
  const lines = [
    `${domain} wants you to sign in with your Solana account:`,
    String(address),
  ];

  if (input.statement !== undefined) {
    lines.push('', String(input.statement));
  }

  const fields = [
    ['URI', input.uri],
    ['Version', input.version],
    ['Chain ID', input.chainId],
    ['Nonce', input.nonce],
    ['Issued At', input.issuedAt],
    ['Expiration Time', input.expirationTime],
    ['Not Before', input.notBefore],
    ['Request ID', input.requestId],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined) {
      lines.push(`${label}: ${String(value)}`);
    }
  }

  if (Array.isArray(input.resources) && input.resources.length > 0) {
    lines.push('Resources:');
    for (const resource of input.resources) {
      lines.push(`- ${String(resource)}`);
    }
  }

  return new TextEncoder().encode(lines.join('\n'));
};

const handleSolanaSessionRequest = async (
  wallet: MockWalletController,
  solana: WalletConnectSolanaNamespace,
  event: SessionRequestEvent,
  context: { origin?: string } | { bypassOriginCheck: true },
): Promise<unknown> => {
  const method = event.params.request.method;
  if (!solana.methods.includes(method)) {
    throw rpcError(4200, `The mock wallet does not support the method "${method}".`);
  }

  const params = normalizeObjectParams(event.params.request.params);

  switch (method) {
    case 'solana_getAccounts': {
      const accounts = (await wallet.handleExternalRequest({ method: 'eth_accounts', params: [] }, context)) as
        | unknown[]
        | undefined;
      return accounts && accounts.length > 0 ? solanaAccountsResult(solana) : [];
    }

    case 'solana_requestAccounts':
      await wallet.handleExternalRequest({ method, params: [params] }, context);
      return solanaAccountsResult(solana);

    case 'solana_signIn': {
      const input = normalizeObjectParams(params.input ?? params);
      if (input.address !== undefined && input.address !== solana.publicKey) {
        throw rpcError(4100, `The requested Solana account ${String(input.address)} is not authorized.`);
      }
      const signedMessage = buildSolanaSignInMessage(solana.publicKey, input);
      await wallet.handleExternalRequest(
        {
          method,
          params: [{ input, publicKey: solana.publicKey, message: [...signedMessage] }],
        },
        context,
      );
      return {
        address: input.address ?? solana.publicKey,
        publicKey: solana.publicKey,
        signedMessage: [...signedMessage],
        signature: signatureFor(solana.publicKey, signedMessage),
        signatureType: 'ed25519',
      };
    }

    case 'solana_signMessage':
      assertSolanaPubkey(params, solana.publicKey);
      await wallet.handleExternalRequest({ method, params: [params] }, context);
      return {
        signature: signatureFor(solana.publicKey, params.message ?? ''),
      };

    case 'solana_signTransaction':
      await wallet.handleExternalRequest({ method, params: [params] }, context);
      return {
        signature: signatureFor(solana.publicKey, params.transaction ?? params),
        ...(typeof params.transaction === 'string' ? { transaction: params.transaction } : {}),
      };

    case 'solana_signAllTransactions': {
      await wallet.handleExternalRequest({ method, params: [params] }, context);
      const transactions = Array.isArray(params.transactions) ? params.transactions : [];
      return {
        transactions,
        signatures: transactions.map((transaction) => signatureFor(solana.publicKey, transaction)),
      };
    }

    case 'solana_signAndSendAllTransactions': {
      await wallet.handleExternalRequest({ method, params: [params] }, context);
      const transactions = Array.isArray(params.transactions) ? params.transactions : [];
      return {
        publicKey: solana.publicKey,
        signatures: transactions.map((transaction) => signatureFor(solana.publicKey, transaction)),
      };
    }

    case 'solana_signAndSendTransaction':
      await wallet.handleExternalRequest({ method, params: [params] }, context);
      return {
        signature: signatureFor(solana.publicKey, params.transaction ?? params),
      };

    default:
      throw rpcError(4200, `The mock wallet does not support the method "${method}".`);
  }
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
  config: {
    chains: readonly Hex[];
    getChains?: () => readonly Hex[];
    enforceOrigins: boolean;
    solana?: WalletConnectSolanaNamespace;
  },
  respond: (topic: string, response: SessionRequestResponse) => Promise<void>,
): ((event: SessionRequestEvent) => Promise<void>) => {
  return async (event) => {
    const { id, topic, params, verifyContext } = event;
    try {
      const context = config.enforceOrigins
        ? { origin: verifyContext?.verified?.origin }
        : { bypassOriginCheck: true as const };

      const solanaChain = parseSolanaCaipChainId(params.chainId);
      if (solanaChain) {
        if (!config.solana || !config.solana.chains.includes(solanaChain)) {
          await respond(topic, {
            id,
            jsonrpc: '2.0',
            error: { code: 5100, message: 'Requested chain is not approved for this session.' },
          });
          return;
        }

        const result = await handleSolanaSessionRequest(wallet, config.solana, event, context);
        await respond(topic, { id, jsonrpc: '2.0', result });
        return;
      }

      const chainId = parseCaipChainId(params.chainId);
      const approvedChains = config.getChains?.() ?? config.chains;
      if (!chainId || !approvedChains.includes(chainId)) {
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
        { method: params.request.method, params: normalizeJsonRpcParams(params.request.params) },
        context,
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

export const createSessionAuthenticateHandler = (
  wallet: MockWalletController,
  config: {
    chains: readonly Hex[];
    getChains?: () => readonly Hex[];
    enforceOrigins: boolean;
  },
  auth: {
    approve(id: number, auths: readonly WalletConnectCacao[]): Promise<{
      session?: {
        topic: string;
        namespaces?: Record<string, unknown>;
        peer?: { metadata?: WalletConnectMetadata };
      };
    }>;
    buildAuthObject(
      requestPayload: Record<string, unknown>,
      signature: { t: 'eip191' | 'eip1271'; s: string; m?: string },
      iss: string,
    ): WalletConnectCacao;
    formatAuthMessage(args: { request: Record<string, unknown>; iss: string }): string;
    getSdkError(code: string): unknown;
    onSession?(session: WalletConnectSession): void;
    reject(id: number, reason: unknown): Promise<void>;
  },
): ((event: SessionAuthenticateEvent) => Promise<void>) => {
  return async (event) => {
    const { id, params, verifyContext } = event;
    const context = config.enforceOrigins
      ? { origin: verifyContext?.verified?.origin }
      : { bypassOriginCheck: true as const };

    const requestedChains = Array.isArray(params.authPayload.chains)
      ? params.authPayload.chains.map(parseCaipChainId)
      : [];
    const approvedChains = config.getChains?.() ?? config.chains;
    const unsupported = requestedChains.some((chainId) => !chainId || !approvedChains.includes(chainId));
    if (requestedChains.length === 0 || unsupported) {
      await auth.reject(id, auth.getSdkError('UNSUPPORTED_CHAINS')).catch(() => undefined);
      return;
    }

    try {
      const proposalPayload = {
        origin: verifyContext?.verified?.origin,
        requester: params.requester?.metadata,
        authPayload: params.authPayload,
      };
      const accounts = (await wallet.handleExternalRequest(
        { method: 'eth_requestAccounts', params: [proposalPayload] },
        context,
      )) as readonly Address[];

      const auths: WalletConnectCacao[] = [];
      for (const chainId of requestedChains as Hex[]) {
        const caip = toCaipChainId(chainId);
        for (const account of accounts) {
          const iss = `did:pkh:${caip}:${account}`;
          const message = auth.formatAuthMessage({ request: params.authPayload, iss });
          const signature = (await wallet.handleExternalRequest(
            { method: 'personal_sign', params: [toHex(message), account] },
            context,
          )) as Hex;
          auths.push(
            auth.buildAuthObject(
              params.authPayload,
              { t: 'eip191', s: signature, m: message },
              iss,
            ),
          );
        }
      }

      const result = await auth.approve(id, auths);
      if (result.session) {
        auth.onSession?.({
          topic: result.session.topic,
          namespaces: result.session.namespaces ?? {},
          peerMetadata:
            result.session.peer?.metadata ??
            params.requester?.metadata ??
            ({ name: '', description: '', url: '', icons: [] } satisfies WalletConnectMetadata),
        });
      }
    } catch {
      await auth.reject(id, auth.getSdkError('USER_REJECTED')).catch(() => undefined);
    }
  };
};

const DEFAULT_URI_SELECTORS = ['wui-qr-code', '[uri^="wc:"]', '[data-uri^="wc:"]', '[href^="wc:"]'] as const;
const DEFAULT_URI_ATTRIBUTES = ['uri', 'data-uri', 'href', 'value'] as const;
const DEFAULT_TEXT_SELECTORS = ['textarea', 'input', 'code', 'pre', '[data-wc-uri]'] as const;
const DEFAULT_COPY_BUTTON_SELECTORS = ['[data-testid="copy-wc2-uri"]'] as const;
const URI_PROBE_MS = 250;

const uniq = (values: readonly (string | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
];

const extractWalletConnectUri = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const decoded = /wc%3a/i.test(trimmed)
    ? decodeURIComponent(trimmed)
    : trimmed;
  const match = /wc:[^\s"'<>`]+/.exec(decoded);
  return match?.[0];
};

const readLocatorText = async (locator: Locator): Promise<string | undefined> => {
  return locator
    .first()
    .evaluate(
      (element) => {
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          return element.value;
        }
        return element.textContent ?? '';
      },
      undefined,
      { timeout: URI_PROBE_MS },
    )
    .catch(() => undefined);
};

const readClipboard = async (page: Page): Promise<string | undefined> =>
  page
    .evaluate(() => navigator.clipboard?.readText?.())
    .catch(() => undefined);

/**
 * Polls common WalletConnect QR/modal surfaces for a pairing URI. Defaults
 * keep the AppKit/W3M `wui-qr-code[uri]` contract, then fall back to generic
 * URI attributes, text/value-bearing elements, and AppKit's copy button.
 * For unusual modals pass selectors/textSelectors/copyButtonSelector or use
 * the connect() getUri hook.
 */
export async function getWalletConnectUri(page: Page, options: GetUriOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const selectors = uniq([
    options.selector,
    ...(options.selectors ?? []),
    ...DEFAULT_URI_SELECTORS,
  ]);
  const attributes = options.attributes ?? DEFAULT_URI_ATTRIBUTES;
  const textSelectors = uniq([...(options.textSelectors ?? []), ...DEFAULT_TEXT_SELECTORS]);
  const copyButtonSelectors = uniq([
    options.copyButtonSelector,
    ...(options.copyButtonSelectors ?? []),
    ...DEFAULT_COPY_BUTTON_SELECTORS,
  ]);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      for (const attribute of attributes) {
        const uri = extractWalletConnectUri(
          await locator.getAttribute(attribute, { timeout: URI_PROBE_MS }).catch(() => null),
        );
        if (uri) return uri;
      }
      const uri = extractWalletConnectUri(await readLocatorText(locator));
      if (uri) return uri;
    }

    for (const selector of textSelectors) {
      const uri = extractWalletConnectUri(await readLocatorText(page.locator(selector)));
      if (uri) return uri;
    }

    for (const selector of copyButtonSelectors) {
      const clicked = await page.locator(selector).first().click({ timeout: URI_PROBE_MS }).then(
        () => true,
        () => false,
      );
      if (!clicked) continue;
      const uri = extractWalletConnectUri(await readClipboard(page));
      if (uri) return uri;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for a wc: pairing URI. ` +
      `Probed selectors: ${[...selectors, ...textSelectors].join(', ')}. ` +
      'For unusual modals pass selector/selectors/textSelectors/copyButtonSelector or supply a getUri(page) hook to connect().',
  );
}

export class WalletConnectWallet {
  /** Underlying SignClient — escape hatch for protocol-level access. */
  readonly client: WalletConnectSignClient;

  private readonly wallet: MockWalletController;
  private readonly utils: WcUtils;
  private chains: Hex[];
  private readonly evm: boolean;
  private readonly methods: readonly string[];
  private readonly events: readonly string[];
  private readonly solana?: WalletConnectSolanaNamespace;
  private readonly enforceOrigins: boolean;
  private readonly sessionList: WalletConnectSession[] = [];
  private readonly requestHandler: (event: SessionRequestEvent) => Promise<void>;
  private readonly authHandler?: (event: SessionAuthenticateEvent) => Promise<void>;
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
    const persona = options.persona ? createWalletPersona(options.persona) : undefined;
    this.evm = options.evm ?? persona?.evm !== false;
    this.chains = (options.chains ?? [options.wallet.currentChainId]).map((chainId) =>
      toHex(typeof chainId === 'number' ? chainId : BigInt(chainId)),
    );
    this.methods =
      options.methods ??
      (persona?.flags?.isCoinbaseWallet === true
        ? [...DEFAULT_WALLETCONNECT_METHODS, ...DEFAULT_WALLETCONNECT_COINBASE_METHODS]
        : DEFAULT_WALLETCONNECT_METHODS);
    this.events = options.events ?? DEFAULT_EVENTS;
    this.solana = resolveSolanaOptions(options.solana, persona);
    this.enforceOrigins = options.enforceOrigins ?? true;

    this.requestHandler = createSessionRequestHandler(
      this.wallet,
      {
        chains: this.chains,
        getChains: () => this.chains,
        enforceOrigins: this.enforceOrigins,
        solana: this.solana,
      },
      (topic, response) => this.client.respond({ topic, response }),
    );
    client.on('session_request', this.requestHandler);

    // One-Click Auth / SIWE uses a separate WC event and suppresses
    // sign-client's plain session_proposal fallback once a listener exists.
    // Keep the fallback available through sessionAuthenticate: false.
    if (options.sessionAuthenticate !== false && this.evm) {
      this.authHandler = createSessionAuthenticateHandler(
        this.wallet,
        { chains: this.chains, getChains: () => this.chains, enforceOrigins: this.enforceOrigins },
        {
          approve: (id, auths) => this.client.approveSessionAuthenticate({ id, auths }),
          buildAuthObject: (requestPayload, signature, iss) =>
            this.utils.buildAuthObject(requestPayload, signature, iss),
          formatAuthMessage: (args) => this.client.formatAuthMessage(args),
          getSdkError: (code) => this.utils.getSdkError(code),
          onSession: (session) => {
            this.sessionList.push(session);
          },
          reject: (id, reason) => this.client.rejectSessionAuthenticate({ id, reason }),
        },
      );
      client.on('session_authenticate', this.authHandler);
    }

    this.deleteHandler = ({ topic }) => {
      const index = this.sessionList.findIndex((session) => session.topic === topic);
      if (index !== -1) {
        this.sessionList.splice(index, 1);
      }
    };
    client.on('session_delete', this.deleteHandler);

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
      customStoragePrefix:
        options.customStoragePrefix ??
        `web3-tester-wallet-${walletConnectStoragePrefixCounter++}`,
      metadata: {
        name: 'web3-tester Wallet',
        description: 'Headless WalletConnect wallet for E2E tests',
        url: 'https://github.com/AndyMarigoldLabs/web3-tester',
        icons: [],
        ...(options.persona
          ? walletConnectMetadataForPersona(createWalletPersona(options.persona))
          : {}),
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
        removeWalletConnectListener(this.client, 'session_proposal', handler);
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
      this.client.on('session_proposal', handler);
      this.client.pair({ uri: options.uri }).catch((error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    // Gate the connect through the controller. Deny-by-default live mode,
    // simulateRejection, and holds all apply with zero new machinery.
    let accounts: readonly Address[];
    try {
      const context = this.enforceOrigins
        ? { origin: proposal.verifyContext?.verified?.origin }
        : { bypassOriginCheck: true as const };
      const proposalPayload = {
        origin: proposal.verifyContext?.verified?.origin,
        proposer: proposal.params?.proposer?.metadata,
        requiredNamespaces: proposal.params?.requiredNamespaces,
        optionalNamespaces: proposal.params?.optionalNamespaces,
      };

      accounts = this.evm
        ? ((await this.wallet.handleExternalRequest(
            { method: 'eth_requestAccounts', params: [proposalPayload] },
            context,
          )) as readonly Address[])
        : [];

      if (!this.evm && this.solana) {
        await this.wallet.handleExternalRequest(
          { method: 'solana_requestAccounts', params: [proposalPayload] },
          context,
        );
      }
    } catch (error) {
      await this.client
        .reject({ id: proposal.id, reason: this.utils.getSdkError('USER_REJECTED') })
        .catch(() => undefined);
      throw error;
    }

    let namespaces: Record<string, unknown>;
    try {
      const supportedNamespaces: Record<string, unknown> = {};
      if (this.evm) {
        supportedNamespaces.eip155 = {
          chains: this.chains.map(toCaipChainId),
          methods: [...this.methods],
          events: [...this.events],
          accounts: this.chains.flatMap((chainId) =>
            accounts.map((account) => `${toCaipChainId(chainId)}:${account}`),
          ),
        };
      }
      if (this.solana) {
        supportedNamespaces.solana = {
          chains: [...this.solana.chains],
          methods: [...this.solana.methods],
          events: [...this.solana.events],
          accounts: this.solana.chains.map((chain) => `${chain}:${this.solana!.publicKey}`),
        };
      }
      if (Object.keys(supportedNamespaces).length === 0) {
        throw new Error('No WalletConnect namespaces are enabled.');
      }

      namespaces = this.utils.buildApprovedNamespaces({
        proposal: proposal.params,
        supportedNamespaces,
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
    removeWalletConnectListener(this.client, 'session_request', this.requestHandler);
    removeWalletConnectListener(this.client, 'session_delete', this.deleteHandler);
    if (this.authHandler) {
      removeWalletConnectListener(this.client, 'session_authenticate', this.authHandler);
    }

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
          if (!(session.namespaces as { eip155?: unknown }).eip155) continue;
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
          const namespaces = session.namespaces as {
            eip155?: { chains?: string[]; accounts?: string[]; [key: string]: unknown };
            solana?: { chains?: string[] };
          };
          if (namespaces.eip155) {
            const accounts = Array.isArray(payload) ? payload.filter(isAddressString) : [];
            if (accounts.length > 0) {
              const caipChains = (namespaces.eip155.chains ?? this.chains.map(toCaipChainId)).filter(
                (chainId): chainId is string => typeof chainId === 'string',
              );
              const nextAccounts = eip155AccountsFor(caipChains, accounts);
              if (!arraysEqual(namespaces.eip155.accounts, nextAccounts)) {
                const updated = {
                  ...namespaces,
                  eip155: {
                    ...namespaces.eip155,
                    accounts: nextAccounts,
                  },
                };
                await this.client.update({ topic: session.topic, namespaces: updated });
                session.namespaces = updated;
              }
            }
            await this.client.emit({
              topic: session.topic,
              event: { name: 'accountsChanged', data: payload },
              chainId: toCaipChainId(this.wallet.currentChainId),
            });
          }
          if (this.solana && namespaces.solana) {
            const accounts =
              Array.isArray(payload) && payload.length > 0 ? [this.solana.publicKey] : [];
            for (const chainId of namespaces.solana.chains ?? this.solana.chains) {
              await this.client.emit({
                topic: session.topic,
                event: { name: 'accountsChanged', data: accounts },
                chainId,
              });
            }
          }
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
