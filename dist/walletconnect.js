import { toHex } from 'viem';
import { serializeRpcError } from './errors.js';
import { createWalletPersona, walletConnectMetadataForPersona, } from './wallet-personas.js';
const removeWalletConnectListener = (client, event, handler) => {
    if (client.off) {
        client.off(event, handler);
        return;
    }
    client.removeListener?.(event, handler);
};
export const DEFAULT_WALLETCONNECT_METHODS = [
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
export const DEFAULT_WALLETCONNECT_COINBASE_METHODS = [
    'wallet_connect',
    'wallet_addSubAccount',
    'wallet_getSubAccounts',
    'coinbase_fetchPermissions',
    'coinbase_fetchPermission',
];
const DEFAULT_EVENTS = ['chainChanged', 'accountsChanged'];
export const DEFAULT_WALLETCONNECT_SOLANA_METHODS = [
    'solana_getAccounts',
    'solana_requestAccounts',
    'solana_signIn',
    'solana_signAllTransactions',
    'solana_signAndSendAllTransactions',
    'solana_signAndSendTransaction',
    'solana_signMessage',
    'solana_signTransaction',
];
const DEFAULT_SOLANA_EVENTS = ['accountsChanged'];
const DEFAULT_SOLANA_CHAINS = [
    'solana:mainnet',
    'solana:devnet',
    'solana:testnet',
];
// Injectable so the missing-optional-peer hint is hermetically testable
// (the peers are devDependencies here, so they always resolve in-repo).
let loadModule = (specifier) => import(specifier);
let walletConnectStoragePrefixCounter = 0;
/** @internal Test hook: stub the dynamic importer; call with no args to restore. */
export const __setWalletConnectModuleLoader = (loader) => {
    loadModule = loader ?? ((specifier) => import(specifier));
};
const parseCaipChainId = (caip) => {
    const match = typeof caip === 'string' ? /^eip155:(\d+)$/.exec(caip) : null;
    return match ? toHex(BigInt(match[1])) : undefined;
};
const parseSolanaCaipChainId = (caip) => typeof caip === 'string' && /^solana:[a-z0-9-]+$/i.test(caip) ? caip : undefined;
const toCaipChainId = (chainId) => `eip155:${Number(BigInt(chainId))}`;
const isAddressString = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const eip155AccountsFor = (chains, accounts) => chains.flatMap((chainId) => accounts.map((account) => `${chainId}:${account}`));
const arraysEqual = (left = [], right = []) => left.length === right.length && left.every((value, index) => value === right[index]);
const bytesFrom = (input) => {
    if (input instanceof Uint8Array)
        return [...input];
    if (input instanceof ArrayBuffer)
        return [...new Uint8Array(input)];
    if (ArrayBuffer.isView(input)) {
        return [...new Uint8Array(input.buffer, input.byteOffset, input.byteLength)];
    }
    if (Array.isArray(input))
        return input.map((value) => Number(value) & 255);
    if (typeof input === 'string')
        return [...new TextEncoder().encode(input)];
    return [...new TextEncoder().encode(JSON.stringify(input ?? null))];
};
const deterministicSignature = (publicKey, payload) => {
    const seed = [...new TextEncoder().encode(publicKey), ...bytesFrom(payload)];
    const signature = new Uint8Array(64);
    for (let index = 0; index < signature.length; index += 1) {
        const a = seed[index % seed.length] ?? 0;
        const b = seed[(index * 7 + 13) % seed.length] ?? 0;
        signature[index] = (a + b + index * 17) & 255;
    }
    return signature;
};
const base58Encode = (input) => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digits = [0];
    for (const byte of input) {
        let carry = byte;
        for (let index = 0; index < digits.length; index += 1) {
            const next = digits[index] * 256 + carry;
            digits[index] = next % 58;
            carry = Math.floor(next / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }
    for (const byte of input) {
        if (byte !== 0)
            break;
        digits.push(0);
    }
    return digits
        .reverse()
        .map((digit) => alphabet[digit])
        .join('');
};
const signatureFor = (publicKey, payload) => base58Encode(deterministicSignature(publicKey, payload));
const resolveSolanaOptions = (option, persona) => {
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
        publicKey: input.publicKey ??
            personaSolana?.publicKey ??
            '26qv4GCcx98RihuK3c4T6ozB3J7L6VwCuFVc7Ta2A3Uo',
        methods: input.methods ?? DEFAULT_WALLETCONNECT_SOLANA_METHODS,
        events: input.events ?? DEFAULT_SOLANA_EVENTS,
    };
};
const rpcError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
};
const normalizeObjectParams = (params) => {
    const candidate = Array.isArray(params) ? params[0] : params;
    return candidate && typeof candidate === 'object' ? candidate : {};
};
const normalizeJsonRpcParams = (params) => {
    if (params === undefined || Array.isArray(params))
        return params;
    if (params && typeof params === 'object')
        return params;
    return [params];
};
const assertSolanaPubkey = (params, publicKey) => {
    const requested = params.pubkey;
    if (requested !== undefined && requested !== publicKey) {
        throw rpcError(4100, `The requested Solana account ${String(requested)} is not authorized.`);
    }
};
const solanaAccountsResult = (solana) => [
    { pubkey: solana.publicKey },
];
const buildSolanaSignInMessage = (publicKey, input = {}) => {
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
const handleSolanaSessionRequest = async (wallet, solana, event, context) => {
    const method = event.params.request.method;
    if (!solana.methods.includes(method)) {
        throw rpcError(4200, `The mock wallet does not support the method "${method}".`);
    }
    const params = normalizeObjectParams(event.params.request.params);
    switch (method) {
        case 'solana_getAccounts': {
            const accounts = (await wallet.handleExternalRequest({ method: 'eth_accounts', params: [] }, context));
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
            await wallet.handleExternalRequest({
                method,
                params: [{ input, publicKey: solana.publicKey, message: [...signedMessage] }],
            }, context);
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
export const createSessionRequestHandler = (wallet, config, respond) => {
    return async (event) => {
        const { id, topic, params, verifyContext } = event;
        try {
            const context = config.enforceOrigins
                ? { origin: verifyContext?.verified?.origin }
                : { bypassOriginCheck: true };
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
            const result = await wallet.handleExternalRequest({ method: params.request.method, params: normalizeJsonRpcParams(params.request.params) }, context);
            await respond(topic, { id, jsonrpc: '2.0', result });
        }
        catch (error) {
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
export const createSessionAuthenticateHandler = (wallet, config, auth) => {
    return async (event) => {
        const { id, params, verifyContext } = event;
        const context = config.enforceOrigins
            ? { origin: verifyContext?.verified?.origin }
            : { bypassOriginCheck: true };
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
            const accounts = (await wallet.handleExternalRequest({ method: 'eth_requestAccounts', params: [proposalPayload] }, context));
            const auths = [];
            for (const chainId of requestedChains) {
                const caip = toCaipChainId(chainId);
                for (const account of accounts) {
                    const iss = `did:pkh:${caip}:${account}`;
                    const message = auth.formatAuthMessage({ request: params.authPayload, iss });
                    const signature = (await wallet.handleExternalRequest({ method: 'personal_sign', params: [toHex(message), account] }, context));
                    auths.push(auth.buildAuthObject(params.authPayload, { t: 'eip191', s: signature, m: message }, iss));
                }
            }
            const result = await auth.approve(id, auths);
            if (result.session) {
                auth.onSession?.({
                    topic: result.session.topic,
                    namespaces: result.session.namespaces ?? {},
                    peerMetadata: result.session.peer?.metadata ??
                        params.requester?.metadata ??
                        { name: '', description: '', url: '', icons: [] },
                });
            }
        }
        catch {
            await auth.reject(id, auth.getSdkError('USER_REJECTED')).catch(() => undefined);
        }
    };
};
const DEFAULT_URI_SELECTORS = ['wui-qr-code', '[uri^="wc:"]', '[data-uri^="wc:"]', '[href^="wc:"]'];
const DEFAULT_URI_ATTRIBUTES = ['uri', 'data-uri', 'href', 'value'];
const DEFAULT_TEXT_SELECTORS = ['textarea', 'input', 'code', 'pre', '[data-wc-uri]'];
const DEFAULT_COPY_BUTTON_SELECTORS = ['[data-testid="copy-wc2-uri"]'];
const URI_PROBE_MS = 250;
const uniq = (values) => [
    ...new Set(values.filter((value) => Boolean(value))),
];
const extractWalletConnectUri = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    const decoded = /wc%3a/i.test(trimmed)
        ? decodeURIComponent(trimmed)
        : trimmed;
    const match = /wc:[^\s"'<>`]+/.exec(decoded);
    return match?.[0];
};
const readLocatorText = async (locator) => {
    return locator
        .first()
        .evaluate((element) => {
        if (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement) {
            return element.value;
        }
        return element.textContent ?? '';
    }, undefined, { timeout: URI_PROBE_MS })
        .catch(() => undefined);
};
const readClipboard = async (page) => page
    .evaluate(() => navigator.clipboard?.readText?.())
    .catch(() => undefined);
/**
 * Polls common WalletConnect QR/modal surfaces for a pairing URI. Defaults
 * keep the AppKit/W3M `wui-qr-code[uri]` contract, then fall back to generic
 * URI attributes, text/value-bearing elements, and AppKit's copy button.
 * For unusual modals pass selectors/textSelectors/copyButtonSelector or use
 * the connect() getUri hook.
 */
export async function getWalletConnectUri(page, options = {}) {
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
                const uri = extractWalletConnectUri(await locator.getAttribute(attribute, { timeout: URI_PROBE_MS }).catch(() => null));
                if (uri)
                    return uri;
            }
            const uri = extractWalletConnectUri(await readLocatorText(locator));
            if (uri)
                return uri;
        }
        for (const selector of textSelectors) {
            const uri = extractWalletConnectUri(await readLocatorText(page.locator(selector)));
            if (uri)
                return uri;
        }
        for (const selector of copyButtonSelectors) {
            const clicked = await page.locator(selector).first().click({ timeout: URI_PROBE_MS }).then(() => true, () => false);
            if (!clicked)
                continue;
            const uri = extractWalletConnectUri(await readClipboard(page));
            if (uri)
                return uri;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for a wc: pairing URI. ` +
        `Probed selectors: ${[...selectors, ...textSelectors].join(', ')}. ` +
        'For unusual modals pass selector/selectors/textSelectors/copyButtonSelector or supply a getUri(page) hook to connect().');
}
export class WalletConnectWallet {
    /** Underlying SignClient — escape hatch for protocol-level access. */
    client;
    wallet;
    utils;
    chains;
    evm;
    methods;
    events;
    solana;
    enforceOrigins;
    sessionList = [];
    requestHandler;
    authHandler;
    deleteHandler;
    unsubscribeProviderEvents;
    closed = false;
    constructor(client, utils, options) {
        this.client = client;
        this.utils = utils;
        this.wallet = options.wallet;
        const persona = options.persona ? createWalletPersona(options.persona) : undefined;
        this.evm = options.evm ?? persona?.evm !== false;
        this.chains = (options.chains ?? [options.wallet.currentChainId]).map((chainId) => toHex(typeof chainId === 'number' ? chainId : BigInt(chainId)));
        this.methods =
            options.methods ??
                (persona?.flags?.isCoinbaseWallet === true
                    ? [...DEFAULT_WALLETCONNECT_METHODS, ...DEFAULT_WALLETCONNECT_COINBASE_METHODS]
                    : DEFAULT_WALLETCONNECT_METHODS);
        this.events = options.events ?? DEFAULT_EVENTS;
        this.solana = resolveSolanaOptions(options.solana, persona);
        this.enforceOrigins = options.enforceOrigins ?? true;
        this.requestHandler = createSessionRequestHandler(this.wallet, {
            chains: this.chains,
            getChains: () => this.chains,
            enforceOrigins: this.enforceOrigins,
            solana: this.solana,
        }, (topic, response) => this.client.respond({ topic, response }));
        client.on('session_request', this.requestHandler);
        // One-Click Auth / SIWE uses a separate WC event and suppresses
        // sign-client's plain session_proposal fallback once a listener exists.
        // Keep the fallback available through sessionAuthenticate: false.
        if (options.sessionAuthenticate !== false && this.evm) {
            this.authHandler = createSessionAuthenticateHandler(this.wallet, { chains: this.chains, getChains: () => this.chains, enforceOrigins: this.enforceOrigins }, {
                approve: (id, auths) => this.client.approveSessionAuthenticate({ id, auths }),
                buildAuthObject: (requestPayload, signature, iss) => this.utils.buildAuthObject(requestPayload, signature, iss),
                formatAuthMessage: (args) => this.client.formatAuthMessage(args),
                getSdkError: (code) => this.utils.getSdkError(code),
                onSession: (session) => {
                    this.sessionList.push(session);
                },
                reject: (id, reason) => this.client.rejectSessionAuthenticate({ id, reason }),
            });
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
    static async create(options) {
        let signClientModule;
        let utils;
        try {
            signClientModule = (await loadModule('@walletconnect/sign-client'));
            utils = (await loadModule('@walletconnect/utils'));
        }
        catch (error) {
            throw new Error("The './walletconnect' module requires optional peer dependencies. " +
                'Install with: npm i -D @walletconnect/sign-client @walletconnect/utils @walletconnect/types', { cause: error });
        }
        const SignClient = (signClientModule.SignClient ??
            signClientModule.default ??
            signClientModule);
        const client = await SignClient.init({
            projectId: options.projectId,
            ...(options.relayUrl ? { relayUrl: options.relayUrl } : {}),
            customStoragePrefix: options.customStoragePrefix ??
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
    get sessions() {
        return [...this.sessionList];
    }
    /**
     * Pairs with a wc: URI, gates the session proposal through the controller
     * (as a synthetic eth_requestAccounts — approveNext('eth_requestAccounts')
     * arms it; the match callback receives the proposal payload), builds the
     * approved namespaces, and settles the session.
     */
    async pair(options) {
        const timeoutMs = options.timeoutMs ?? 30_000;
        const { topic: pairingTopic } = this.utils.parseUri(options.uri);
        const proposal = await new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                removeWalletConnectListener(this.client, 'session_proposal', handler);
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out after ${timeoutMs}ms waiting for the session proposal.`));
            }, timeoutMs);
            const handler = (event) => {
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
        let accounts;
        try {
            const context = this.enforceOrigins
                ? { origin: proposal.verifyContext?.verified?.origin }
                : { bypassOriginCheck: true };
            const proposalPayload = {
                origin: proposal.verifyContext?.verified?.origin,
                proposer: proposal.params?.proposer?.metadata,
                requiredNamespaces: proposal.params?.requiredNamespaces,
                optionalNamespaces: proposal.params?.optionalNamespaces,
            };
            accounts = this.evm
                ? (await this.wallet.handleExternalRequest({ method: 'eth_requestAccounts', params: [proposalPayload] }, context))
                : [];
            if (!this.evm && this.solana) {
                await this.wallet.handleExternalRequest({ method: 'solana_requestAccounts', params: [proposalPayload] }, context);
            }
        }
        catch (error) {
            await this.client
                .reject({ id: proposal.id, reason: this.utils.getSdkError('USER_REJECTED') })
                .catch(() => undefined);
            throw error;
        }
        let namespaces;
        try {
            const supportedNamespaces = {};
            if (this.evm) {
                supportedNamespaces.eip155 = {
                    chains: this.chains.map(toCaipChainId),
                    methods: [...this.methods],
                    events: [...this.events],
                    accounts: this.chains.flatMap((chainId) => accounts.map((account) => `${toCaipChainId(chainId)}:${account}`)),
                };
            }
            if (this.solana) {
                supportedNamespaces.solana = {
                    chains: [...this.solana.chains],
                    methods: [...this.solana.methods],
                    events: [...this.solana.events],
                    accounts: this.solana.chains.map((chain) => `${chain}:${this.solana.publicKey}`),
                };
            }
            if (Object.keys(supportedNamespaces).length === 0) {
                throw new Error('No WalletConnect namespaces are enabled.');
            }
            namespaces = this.utils.buildApprovedNamespaces({
                proposal: proposal.params,
                supportedNamespaces,
            });
        }
        catch (error) {
            await this.client
                .reject({ id: proposal.id, reason: this.utils.getSdkError('UNSUPPORTED_CHAINS') })
                .catch(() => undefined);
            throw new Error("Could not satisfy the dapp's requested namespaces — pass the chains it needs in " +
                `WalletConnectWalletOptions.chains. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
        const { topic, acknowledged } = await this.client.approve({ id: proposal.id, namespaces });
        const settled = await acknowledged();
        const session = {
            topic,
            namespaces: settled?.namespaces ?? namespaces,
            peerMetadata: proposal.params?.proposer?.metadata ??
                { name: '', description: '', url: '', icons: [] },
        };
        this.sessionList.push(session);
        return session;
    }
    /** Convenience: extract the URI from the dapp's modal, then pair(). */
    async connect(page, options = {}) {
        const uri = options.getUri ? await options.getUri(page) : await getWalletConnectUri(page, options);
        return this.pair({ uri, timeoutMs: options.timeoutMs });
    }
    /** Wallet-initiated disconnect; all sessions when topic is omitted. */
    async disconnect(topic) {
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
    async close() {
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
    async forwardProviderEvent(event, payload) {
        for (const session of [...this.sessionList]) {
            try {
                if (event === 'chainChanged') {
                    if (!session.namespaces.eip155)
                        continue;
                    const chainId = payload;
                    if (!this.chains.includes(chainId)) {
                        // Extend the session namespace first (MetaMask-mobile behavior).
                        this.chains = [...this.chains, chainId];
                        const namespaces = session.namespaces;
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
                }
                else if (event === 'accountsChanged') {
                    const namespaces = session.namespaces;
                    if (namespaces.eip155) {
                        const accounts = Array.isArray(payload) ? payload.filter(isAddressString) : [];
                        if (accounts.length > 0) {
                            const caipChains = (namespaces.eip155.chains ?? this.chains.map(toCaipChainId)).filter((chainId) => typeof chainId === 'string');
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
                        const accounts = Array.isArray(payload) && payload.length > 0 ? [this.solana.publicKey] : [];
                        for (const chainId of namespaces.solana.chains ?? this.solana.chains) {
                            await this.client.emit({
                                topic: session.topic,
                                event: { name: 'accountsChanged', data: accounts },
                                chainId,
                            });
                        }
                    }
                }
                else if (event === 'disconnect') {
                    await this.client
                        .disconnect({ topic: session.topic, reason: this.utils.getSdkError('USER_DISCONNECTED') })
                        .catch(() => undefined);
                    this.deleteHandler({ topic: session.topic });
                }
            }
            catch {
                // Relay errors must never break wallet state transitions.
            }
        }
    }
}
//# sourceMappingURL=walletconnect.js.map