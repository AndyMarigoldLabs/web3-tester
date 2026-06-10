import { toHex } from 'viem';
import { providerError, serializeRpcError } from './errors.js';
import { buildInjectedProviderScript, emitterName, rpcBridgeName, } from './injected-provider.js';
const DEFAULT_PROVIDER_INFO = {
    uuid: '00000000-0000-4000-8000-000000000001',
    name: 'Mock Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%23111827"/><path d="M17 34h30v14H17z" fill="%2338bdf8"/><path d="M20 18h24v16H20z" fill="%23f59e0b"/><circle cx="43" cy="41" r="3" fill="%23111827"/></svg>',
    rdns: 'dev.invisible-wallet.mock',
};
const defaultAdditionalProviderInfo = (index) => ({
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
const normalizeParams = (params) => {
    if (params === undefined) {
        return [];
    }
    if (Array.isArray(params)) {
        return [...params];
    }
    return [params];
};
const normalizeChainId = (chainId) => typeof chainId === 'number' ? toHex(chainId) : chainId;
export class MockWalletController {
    page;
    rpcClient;
    accounts;
    chainId;
    connected;
    approveRequests;
    rejectionQueue = [];
    holdQueue = [];
    knownChainIds = new Set();
    sentTransactions = [];
    sentTransactionRequests = [];
    constructor(page, rpcClient, options) {
        this.page = page;
        this.rpcClient = rpcClient;
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
    providerInfo;
    providerInfos;
    get primaryAccount() {
        return this.accounts[0];
    }
    get currentChainId() {
        return this.chainId;
    }
    async injectMockProvider() {
        // Context-level injection so pages the dapp opens itself (window.open,
        // target=_blank flows) get the provider too.
        const context = this.page.context();
        try {
            await context.exposeFunction(rpcBridgeName, async (request) => {
                try {
                    const result = await this.handleRpcRequest(request);
                    return { ok: true, result };
                }
                catch (error) {
                    return { ok: false, error: serializeRpcError(error) };
                }
            });
        }
        catch (error) {
            if (error instanceof Error && /already registered/i.test(error.message)) {
                throw new Error('A mock wallet provider is already injected into this browser context. Create one MockWalletController per context.', { cause: error });
            }
            throw error;
        }
        const config = {
            accounts: this.accounts,
            autoApprove: this.approveRequests,
            chainId: this.chainId,
            connected: this.connected,
            providers: this.providerInfos,
        };
        const providerScript = buildInjectedProviderScript(config);
        await context.addInitScript(providerScript);
        await Promise.all(context.pages().map((page) => page.evaluate(providerScript).catch(() => undefined)));
    }
    autoApprove(enabled = true) {
        this.approveRequests = enabled;
    }
    async simulateRejection(methods = [...APPROVAL_GATED_METHODS], message = 'User rejected the request.') {
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
    holdNextRequest(methods) {
        return new Promise((resolveHeld) => {
            this.holdQueue.push({
                methods: typeof methods === 'string' ? [methods] : methods,
                intercept: (method, params) => new Promise((approve, rejectGate) => {
                    resolveHeld({
                        method,
                        params,
                        approve: () => approve(),
                        reject: (message = 'User rejected the request.') => rejectGate(providerError(4001, message)),
                    });
                }),
            });
        });
    }
    /**
     * Resolves with the hash of the next transaction the page submits after
     * this call. Invoke before triggering the dapp action, then await it.
     */
    async waitForNextTransaction(options = {}) {
        const timeoutMs = options.timeoutMs ?? 15_000;
        const baseline = this.sentTransactions.length;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.sentTransactions.length > baseline) {
                return this.sentTransactions[baseline];
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Timed out after ${timeoutMs}ms waiting for the page to submit a transaction.`);
    }
    async setAccounts(accounts) {
        if (accounts.length === 0) {
            throw new Error('setAccounts requires at least one account. Use disconnect() to expose no accounts.');
        }
        this.accounts = [...accounts];
        this.connected = true;
        await this.emit('accountsChanged', this.accounts);
    }
    async disconnect() {
        this.connected = false;
        await this.emit('accountsChanged', []);
        await this.emit('disconnect', { code: 4900, message: 'Mock wallet disconnected.' });
    }
    async reconnect() {
        this.connected = true;
        await this.emit('connect', { chainId: this.chainId });
        await this.emit('accountsChanged', this.accounts);
    }
    async switchNetwork(chainId) {
        this.chainId = normalizeChainId(chainId);
        // A test-driven switch counts as the user adding/approving the chain.
        this.knownChainIds.add(this.chainId);
        await this.emit('chainChanged', this.chainId);
    }
    async emit(event, payload) {
        await Promise.all(this.page.context().pages().map((page) => page
            .evaluate(({ emitter, eventName, eventPayload }) => {
            const maybeEmitter = window[emitter];
            if (typeof maybeEmitter === 'function') {
                maybeEmitter(eventName, eventPayload);
            }
        }, { emitter: emitterName, eventName: event, eventPayload: payload })
            .catch(() => undefined)));
    }
    consumeRejection(method) {
        const index = this.rejectionQueue.findIndex((rule) => !rule.methods || rule.methods.includes(method));
        if (index === -1) {
            return undefined;
        }
        const [rule] = this.rejectionQueue.splice(index, 1);
        return rule;
    }
    consumeHold(method) {
        const index = this.holdQueue.findIndex((rule) => !rule.methods || rule.methods.includes(method));
        if (index === -1) {
            return undefined;
        }
        const [rule] = this.holdQueue.splice(index, 1);
        return rule;
    }
    async assertUserApproved(method, params) {
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
    permissionResponse() {
        return [
            {
                parentCapability: 'eth_accounts',
                caveats: [{ type: 'restrictReturnedAccounts', value: [...this.accounts] }],
            },
        ];
    }
    async handleRpcRequest(request) {
        const { method } = request;
        const params = normalizeParams(request.params);
        if (!this.connected && SIGNING_METHODS.has(method)) {
            throw providerError(4100, 'The requested account and/or method has not been authorized by the user.');
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
                const requestedChain = params[0];
                if (!requestedChain?.chainId) {
                    throw providerError(-32602, 'wallet_switchEthereumChain requires a chainId.');
                }
                const normalized = normalizeChainId(requestedChain.chainId);
                if (!this.knownChainIds.has(normalized)) {
                    throw providerError(4902, `Unrecognized chain ID "${normalized}". Try adding the chain using wallet_addEthereumChain first.`);
                }
                await this.switchNetwork(normalized);
                return null;
            }
            case 'wallet_addEthereumChain': {
                await this.assertUserApproved(method, params);
                const definition = params[0];
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
                const transaction = { ...params[0] };
                transaction.from ??= this.primaryAccount;
                const hash = (await this.rpcClient.request({
                    method,
                    params: [transaction],
                }));
                this.sentTransactions.push(hash);
                this.sentTransactionRequests.push({
                    hash,
                    from: transaction.from,
                    to: transaction.to,
                    data: transaction.data,
                    value: transaction.value !== undefined ? String(transaction.value) : undefined,
                });
                return hash;
            }
            case 'eth_signTypedData':
                throw providerError(4200, 'eth_signTypedData (legacy v1) is not supported by the mock wallet. Use eth_signTypedData_v4.');
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
                    throw providerError(4200, `The mock wallet does not support the method "${method}".`);
                }
                return this.rpcClient.request({ method, params });
        }
    }
}
//# sourceMappingURL=mock-wallet-controller.js.map