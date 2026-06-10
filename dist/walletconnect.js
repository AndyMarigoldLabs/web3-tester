import { toHex } from 'viem';
import { serializeRpcError } from './errors.js';
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
];
const DEFAULT_EVENTS = ['chainChanged', 'accountsChanged'];
// Injectable so the missing-optional-peer hint is hermetically testable
// (the peers are devDependencies here, so they always resolve in-repo).
let loadModule = (specifier) => import(specifier);
/** @internal Test hook: stub the dynamic importer; call with no args to restore. */
export const __setWalletConnectModuleLoader = (loader) => {
    loadModule = loader ?? ((specifier) => import(specifier));
};
const parseCaipChainId = (caip) => {
    const match = typeof caip === 'string' ? /^eip155:(\d+)$/.exec(caip) : null;
    return match ? toHex(BigInt(match[1])) : undefined;
};
const toCaipChainId = (chainId) => `eip155:${Number(BigInt(chainId))}`;
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
            const result = await wallet.handleExternalRequest({ method: params.request.method, params: params.request.params }, config.enforceOrigins
                ? { origin: verifyContext?.verified?.origin }
                : { bypassOriginCheck: true });
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
/**
 * Polls the AppKit/W3M modal for the pairing URI: Playwright CSS locators
 * pierce the shadow DOM, and AppKit's w3m-connecting-wc-qrcode renders
 * `<wui-qr-code uri=...>` as a real DOM attribute (the same contract
 * Reown's own laboratory tests read). For non-AppKit modals pass a
 * `selector` or use the connect() `getUri` hook.
 */
export async function getWalletConnectUri(page, options = {}) {
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
    throw new Error(`Timed out after ${timeoutMs}ms waiting for a wc: pairing URI on "${selector}". ` +
        'For non-AppKit modals pass { selector } or supply a getUri(page) hook to connect().');
}
export class WalletConnectWallet {
    /** Underlying SignClient — escape hatch for protocol-level access. */
    client;
    wallet;
    utils;
    chains;
    methods;
    events;
    enforceOrigins;
    sessionList = [];
    requestHandler;
    deleteHandler;
    unsubscribeProviderEvents;
    closed = false;
    constructor(client, utils, options) {
        this.client = client;
        this.utils = utils;
        this.wallet = options.wallet;
        this.chains = (options.chains ?? [options.wallet.currentChainId]).map((chainId) => toHex(typeof chainId === 'number' ? chainId : BigInt(chainId)));
        this.methods = options.methods ?? DEFAULT_WALLETCONNECT_METHODS;
        this.events = options.events ?? DEFAULT_EVENTS;
        this.enforceOrigins = options.enforceOrigins ?? true;
        // INVARIANT: never register a 'session_authenticate' listener. With zero
        // listeners, sign-client routes One-Click Auth (SIWE) dapps through the
        // wc_sessionPropose fallback — a plain session plus personal_sign —
        // which this wallet handles. Subscribing would suppress that fallback.
        this.requestHandler = createSessionRequestHandler(this.wallet, { chains: this.chains, enforceOrigins: this.enforceOrigins }, (topic, response) => this.client.respond({ topic, response }));
        client.on('session_request', this.requestHandler);
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
                (this.client.off ?? this.client.removeListener)?.call(this.client, 'session_proposal', handler);
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
            accounts = (await this.wallet.handleExternalRequest({
                method: 'eth_requestAccounts',
                params: [
                    {
                        origin: proposal.verifyContext?.verified?.origin,
                        proposer: proposal.params?.proposer?.metadata,
                        requiredNamespaces: proposal.params?.requiredNamespaces,
                        optionalNamespaces: proposal.params?.optionalNamespaces,
                    },
                ],
            }, this.enforceOrigins
                ? { origin: proposal.verifyContext?.verified?.origin }
                : { bypassOriginCheck: true }));
        }
        catch (error) {
            await this.client
                .reject({ id: proposal.id, reason: this.utils.getSdkError('USER_REJECTED') })
                .catch(() => undefined);
            throw error;
        }
        let namespaces;
        try {
            namespaces = this.utils.buildApprovedNamespaces({
                proposal: proposal.params,
                supportedNamespaces: {
                    eip155: {
                        chains: this.chains.map(toCaipChainId),
                        methods: [...this.methods],
                        events: [...this.events],
                        accounts: this.chains.flatMap((chainId) => accounts.map((account) => `${toCaipChainId(chainId)}:${account}`)),
                    },
                },
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
        (this.client.off ?? this.client.removeListener)?.call(this.client, 'session_request', this.requestHandler);
        (this.client.off ?? this.client.removeListener)?.call(this.client, 'session_delete', this.deleteHandler);
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
                    await this.client.emit({
                        topic: session.topic,
                        event: { name: 'accountsChanged', data: payload },
                        chainId: toCaipChainId(this.wallet.currentChainId),
                    });
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