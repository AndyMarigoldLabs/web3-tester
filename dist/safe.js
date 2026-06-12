import { encodeAbiParameters, hashTypedData, isAddress, keccak256, toHex, } from 'viem';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SAFE_APP_BRIDGE_BINDING = '__web3TesterSafeAppBridge';
export const SAFE_MULTISEND_CALL_ONLY_ADDRESS = '0x9641d764fc13c8b624c04430c7356c1c7c8102e2';
const SAFE_MULTISEND_SELECTOR = keccak256(toHex('multiSend(bytes)')).slice(0, 10);
export const SAFE_TRANSACTION_TYPED_DATA_TYPES = {
    SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
    ],
};
const assertAddress = (value, label) => {
    if (!isAddress(value)) {
        throw new Error(`${label} must be a valid address, got "${value}".`);
    }
    return value;
};
const assertHex = (value, label) => {
    if (!/^0x[0-9a-fA-F]*$/.test(value)) {
        throw new Error(`${label} must be 0x-prefixed hex, got "${value}".`);
    }
    return value;
};
const decimal = (value, fallback = 0n) => {
    if (value === undefined)
        return fallback.toString();
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`Safe numeric fields must be non-negative safe integers, got ${value}.`);
        }
        return String(value);
    }
    if (/^\d+$/.test(value))
        return value;
    if (/^0x[0-9a-fA-F]+$/.test(value))
        return BigInt(value).toString();
    throw new Error(`Safe numeric fields must be decimal strings, 0x hex, bigint, or number, got "${value}".`);
};
const bigintValue = (value) => BigInt(value);
export function normalizeSafeTransactionData(data) {
    return {
        to: assertAddress(data.to, 'Safe transaction to'),
        value: decimal(data.value),
        data: assertHex(data.data ?? '0x', 'Safe transaction data'),
        operation: data.operation ?? 0,
        safeTxGas: decimal(data.safeTxGas),
        baseGas: decimal(data.baseGas),
        gasPrice: decimal(data.gasPrice),
        gasToken: assertAddress(data.gasToken ?? ZERO_ADDRESS, 'Safe transaction gasToken'),
        refundReceiver: assertAddress(data.refundReceiver ?? ZERO_ADDRESS, 'Safe transaction refundReceiver'),
        nonce: decimal(data.nonce),
    };
}
export function buildSafeTransactionTypedData(safeAddress, chainId, data) {
    const normalized = normalizeSafeTransactionData(data);
    return {
        domain: {
            chainId: BigInt(chainId),
            verifyingContract: assertAddress(safeAddress, 'Safe address'),
        },
        primaryType: 'SafeTx',
        types: SAFE_TRANSACTION_TYPED_DATA_TYPES,
        message: {
            to: normalized.to,
            value: bigintValue(normalized.value),
            data: normalized.data,
            operation: normalized.operation,
            safeTxGas: bigintValue(normalized.safeTxGas),
            baseGas: bigintValue(normalized.baseGas),
            gasPrice: bigintValue(normalized.gasPrice),
            gasToken: normalized.gasToken,
            refundReceiver: normalized.refundReceiver,
            nonce: bigintValue(normalized.nonce),
        },
    };
}
/**
 * Safe protocol transaction hash, matching Safe.sol getTransactionHash:
 * EIP-712 domain { chainId, verifyingContract: safeAddress } and SafeTx.
 */
export function hashSafeTransactionTypedData(safeAddress, chainId, data) {
    return hashTypedData(buildSafeTransactionTypedData(safeAddress, chainId, data));
}
/**
 * Deterministic local Safe transaction hash for tests and service fixtures.
 * Real Safe deployments should pass the protocol-computed safeTxHash.
 */
export function hashSafeTransactionData(safeAddress, chainId, data) {
    const normalized = normalizeSafeTransactionData(data);
    return keccak256(encodeAbiParameters([
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes' },
        { type: 'uint8' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
    ], [
        safeAddress,
        BigInt(chainId),
        normalized.to,
        bigintValue(normalized.value),
        normalized.data,
        normalized.operation,
        bigintValue(normalized.safeTxGas),
        bigintValue(normalized.baseGas),
        bigintValue(normalized.gasPrice),
        normalized.gasToken,
        normalized.refundReceiver,
        bigintValue(normalized.nonce),
    ]));
}
export function deterministicSafeSignature(safeTxHash, owner) {
    const r = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'string' }], [
        safeTxHash,
        owner,
        'r',
    ]));
    const s = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'string' }], [
        safeTxHash,
        owner,
        's',
    ]));
    return `${r}${s.slice(2)}1b`;
}
const normalizeConfirmation = (input) => ({
    owner: assertAddress(String(input.owner ?? input.ownerAddress ?? ZERO_ADDRESS), 'Safe confirmation owner'),
    signature: assertHex(String(input.signature ?? '0x'), 'Safe confirmation signature'),
    ...(input.submissionDate ? { submissionDate: String(input.submissionDate) } : {}),
});
const normalizeServiceTransaction = (input, fallback) => {
    const data = normalizeSafeTransactionData({
        to: assertAddress(String(input.to), 'Safe transaction to'),
        value: String(input.value ?? '0'),
        data: assertHex(String(input.data ?? '0x'), 'Safe transaction data'),
        operation: Number(input.operation ?? 0),
        safeTxGas: String(input.safeTxGas ?? '0'),
        baseGas: String(input.baseGas ?? '0'),
        gasPrice: String(input.gasPrice ?? '0'),
        gasToken: assertAddress(String(input.gasToken ?? ZERO_ADDRESS), 'Safe transaction gasToken'),
        refundReceiver: assertAddress(String(input.refundReceiver ?? ZERO_ADDRESS), 'Safe transaction refundReceiver'),
        nonce: String(input.nonce ?? '0'),
    });
    return {
        ...data,
        safeAddress: assertAddress(String(input.safe ?? input.safeAddress ?? fallback?.safeAddress ?? ZERO_ADDRESS), 'Safe transaction safeAddress'),
        safeTxHash: assertHex(String(input.safeTxHash ?? input.contractTransactionHash), 'Safe transaction safeTxHash'),
        senderAddress: assertAddress(String(input.sender ?? input.senderAddress ?? fallback?.senderAddress ?? ZERO_ADDRESS), 'Safe transaction senderAddress'),
        ...(input.origin ? { origin: String(input.origin) } : {}),
        confirmations: Array.isArray(input.confirmations)
            ? input.confirmations.map((item) => normalizeConfirmation(item))
            : [],
        ...(input.confirmationsRequired !== undefined
            ? { confirmationsRequired: Number(input.confirmationsRequired) }
            : {}),
        isExecuted: Boolean(input.isExecuted ?? input.executed),
        ...(input.transactionHash ? { transactionHash: assertHex(String(input.transactionHash), 'Safe transaction hash') } : {}),
        ...(input.executor ? { executorAddress: assertAddress(String(input.executor), 'Safe transaction executor') } : {}),
        ...(input.executorAddress
            ? { executorAddress: assertAddress(String(input.executorAddress), 'Safe transaction executor') }
            : {}),
        ...(input.submissionDate ? { submissionDate: String(input.submissionDate) } : {}),
    };
};
const hasResponseBody = (body) => body !== undefined && Object.keys(body).length > 0;
export class SafeTransactionServiceClient {
    fetchImpl;
    baseUrl;
    apiPrefix;
    headers;
    chainId;
    safeTxHashStrategy;
    constructor(options) {
        if (!options.baseUrl) {
            throw new Error('SafeTransactionServiceClient requires baseUrl.');
        }
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.apiPrefix = options.apiPrefix ? `/${options.apiPrefix.replace(/^\/+|\/+$/g, '')}` : '';
        this.chainId = options.chainId;
        this.safeTxHashStrategy =
            options.safeTxHashStrategy ?? (options.chainId === undefined ? 'fixture' : 'eip712');
        this.fetchImpl = options.fetch ?? fetch;
        this.headers = options.headers ?? {};
    }
    async proposeTransaction(proposal) {
        const safeAddress = assertAddress(proposal.safeAddress, 'Safe address');
        const senderAddress = assertAddress(proposal.senderAddress, 'Safe senderAddress');
        const data = normalizeSafeTransactionData(proposal.data);
        const safeTxHash = proposal.safeTxHash ?? this.hashSafeTransaction(safeAddress, proposal.data);
        const body = await this.request(`/safes/${safeAddress}/multisig-transactions/`, {
            method: 'POST',
            body: {
                ...data,
                contractTransactionHash: safeTxHash,
                safeTxHash,
                sender: senderAddress,
                senderAddress,
                signature: proposal.senderSignature,
                origin: proposal.origin,
            },
        });
        if (hasResponseBody(body)) {
            return normalizeServiceTransaction(body, { safeAddress, senderAddress });
        }
        return this.getTransaction(safeTxHash);
    }
    async confirmTransaction(safeTxHash, confirmation) {
        const body = await this.request(`/multisig-transactions/${safeTxHash}/confirmations/`, {
            method: 'POST',
            body: { signature: confirmation.signature },
        });
        if (hasResponseBody(body)) {
            return normalizeServiceTransaction(body);
        }
        return this.getTransaction(safeTxHash);
    }
    async getTransaction(safeTxHash) {
        const body = await this.request(`/multisig-transactions/${safeTxHash}/`, { method: 'GET' });
        if (!hasResponseBody(body)) {
            throw new Error(`Safe Transaction Service returned an empty transaction response for ${safeTxHash}.`);
        }
        return normalizeServiceTransaction(body);
    }
    async listTransactions(safeAddress) {
        const body = await this.request(`/safes/${safeAddress}/multisig-transactions/`, { method: 'GET' });
        return (body?.results ?? []).map((item) => normalizeServiceTransaction(item, { safeAddress }));
    }
    async listConfirmations(safeTxHash) {
        const body = await this.request(`/multisig-transactions/${safeTxHash}/confirmations/`, { method: 'GET' });
        return (body?.results ?? []).map((item) => normalizeConfirmation(item));
    }
    async request(path, options) {
        const response = await this.fetchImpl(`${this.baseUrl}${this.apiPrefix}${path}`, {
            method: options.method,
            headers: {
                accept: 'application/json',
                ...(options.body ? { 'content-type': 'application/json' } : {}),
                ...this.headers,
            },
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`Safe Transaction Service ${options.method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
        }
        const trimmed = text.trim();
        return trimmed ? JSON.parse(trimmed) : undefined;
    }
    hashSafeTransaction(safeAddress, data) {
        if (this.safeTxHashStrategy === 'eip712') {
            if (this.chainId === undefined) {
                throw new Error('SafeTransactionServiceClient requires chainId to compute EIP-712 safeTxHash. Pass safeTxHash explicitly or configure chainId.');
            }
            return hashSafeTransactionTypedData(safeAddress, this.chainId, data);
        }
        return hashSafeTransactionData(safeAddress, this.chainId ?? 0n, data);
    }
}
export class InMemorySafeTransactionService {
    transactions = new Map();
    async proposeTransaction(proposal) {
        const safeAddress = assertAddress(proposal.safeAddress, 'Safe address');
        const senderAddress = assertAddress(proposal.senderAddress, 'Safe senderAddress');
        const safeTxHash = proposal.safeTxHash ?? hashSafeTransactionData(safeAddress, 0n, proposal.data);
        const existing = this.transactions.get(safeTxHash);
        if (existing) {
            throw new Error(`Safe transaction "${safeTxHash}" already exists.`);
        }
        const record = {
            ...normalizeSafeTransactionData(proposal.data),
            safeAddress,
            safeTxHash,
            senderAddress,
            ...(proposal.origin ? { origin: proposal.origin } : {}),
            confirmations: [
                {
                    owner: senderAddress,
                    signature: proposal.senderSignature,
                    submissionDate: new Date().toISOString(),
                },
            ],
            ...(proposal.confirmationsRequired !== undefined
                ? { confirmationsRequired: proposal.confirmationsRequired }
                : {}),
            isExecuted: false,
            submissionDate: new Date().toISOString(),
        };
        this.transactions.set(safeTxHash, record);
        return cloneTransaction(record);
    }
    async confirmTransaction(safeTxHash, confirmation) {
        const record = this.mustGet(safeTxHash);
        if (record.confirmations.some((item) => sameAddress(item.owner, confirmation.owner))) {
            return cloneTransaction(record);
        }
        record.confirmations.push({
            ...confirmation,
            submissionDate: confirmation.submissionDate ?? new Date().toISOString(),
        });
        return cloneTransaction(record);
    }
    async getTransaction(safeTxHash) {
        return cloneTransaction(this.mustGet(safeTxHash));
    }
    async listTransactions(safeAddress) {
        return [...this.transactions.values()]
            .filter((transaction) => sameAddress(transaction.safeAddress, safeAddress))
            .map(cloneTransaction);
    }
    async listConfirmations(safeTxHash) {
        return cloneTransaction(this.mustGet(safeTxHash)).confirmations;
    }
    async markExecuted(safeTxHash, execution) {
        const record = this.mustGet(safeTxHash);
        record.isExecuted = true;
        record.transactionHash = execution.transactionHash;
        record.executorAddress = execution.executorAddress;
        return cloneTransaction(record);
    }
    mustGet(safeTxHash) {
        const record = this.transactions.get(safeTxHash);
        if (!record) {
            throw new Error(`Unknown Safe transaction "${safeTxHash}".`);
        }
        return record;
    }
}
export class SafeWalletHarness {
    safeAddress;
    owners;
    threshold;
    chainId;
    transactionService;
    rpcClient;
    safeTxHashStrategy;
    nonce = 0n;
    constructor(options) {
        this.safeAddress = assertAddress(options.safeAddress, 'Safe address');
        this.owners = options.owners.map((owner) => assertAddress(owner, 'Safe owner'));
        this.threshold = options.threshold;
        this.chainId = options.chainId;
        this.transactionService = options.transactionService;
        this.rpcClient = options.rpcClient;
        this.safeTxHashStrategy = options.safeTxHashStrategy ?? 'eip712';
        if (this.owners.length === 0) {
            throw new Error('SafeWalletHarness requires at least one owner.');
        }
        if (!Number.isInteger(this.threshold) || this.threshold < 1 || this.threshold > this.owners.length) {
            throw new Error(`Safe threshold must be between 1 and owner count (${this.owners.length}), got ${this.threshold}.`);
        }
    }
    async proposeTransaction(options) {
        const proposer = options.proposer ?? this.owners[0];
        this.assertOwner(proposer);
        const data = {
            ...options.transaction,
            nonce: options.transaction.nonce ?? this.nextNonce(),
        };
        const safeTxHash = this.hashSafeTransaction(data);
        const signature = options.signature ?? deterministicSafeSignature(safeTxHash, proposer);
        return this.transactionService.proposeTransaction({
            safeAddress: this.safeAddress,
            senderAddress: proposer,
            safeTxHash,
            senderSignature: signature,
            confirmationsRequired: this.threshold,
            origin: options.origin,
            data,
        });
    }
    async confirmTransaction(safeTxHash, options) {
        this.assertOwner(options.owner);
        return this.transactionService.confirmTransaction(safeTxHash, {
            owner: options.owner,
            signature: options.signature ?? deterministicSafeSignature(safeTxHash, options.owner),
        });
    }
    async executeTransaction(safeTxHash, options = {}) {
        const transaction = await this.transactionService.getTransaction(safeTxHash);
        if (transaction.isExecuted) {
            return { txHash: transaction.transactionHash, transaction };
        }
        if (transaction.confirmations.length < this.threshold) {
            throw new Error(`Safe transaction "${safeTxHash}" has ${transaction.confirmations.length}/${this.threshold} confirmations.`);
        }
        const executor = options.executor ?? transaction.confirmations[0]?.owner ?? this.owners[0];
        this.assertOwner(executor);
        let txHash;
        if (this.rpcClient) {
            txHash = (await this.rpcClient.request({
                method: 'eth_sendTransaction',
                params: [
                    {
                        from: executor,
                        to: transaction.to,
                        value: toHex(bigintValue(transaction.value)),
                        data: transaction.data,
                    },
                ],
            }));
        }
        const executed = txHash && this.transactionService.markExecuted
            ? await this.transactionService.markExecuted(safeTxHash, {
                transactionHash: txHash,
                executorAddress: executor,
            })
            : transaction;
        return { txHash, transaction: executed };
    }
    async getTransaction(safeTxHash) {
        return this.transactionService.getTransaction(safeTxHash);
    }
    async listTransactions() {
        return this.transactionService.listTransactions(this.safeAddress);
    }
    async listConfirmations(safeTxHash) {
        return this.transactionService.listConfirmations(safeTxHash);
    }
    get currentNonce() {
        return this.nonce;
    }
    async requestRpc(request) {
        if (!this.rpcClient) {
            throw new Error('SafeWalletHarness has no rpcClient configured for Safe App rpcCall requests.');
        }
        return this.rpcClient.request(request);
    }
    nextNonce() {
        const value = this.nonce;
        this.nonce += 1n;
        return value.toString();
    }
    hashSafeTransaction(data) {
        if (this.safeTxHashStrategy === 'fixture') {
            return hashSafeTransactionData(this.safeAddress, this.chainId, data);
        }
        return hashSafeTransactionTypedData(this.safeAddress, this.chainId, data);
    }
    assertOwner(owner) {
        if (!this.owners.some((candidate) => sameAddress(candidate, owner))) {
            throw new Error(`"${owner}" is not a Safe owner.`);
        }
    }
}
export async function handleSafeAppRequest(safe, request, options = {}) {
    if (options.allowedOrigins) {
        const origin = options.origin === undefined ? 'null' : toOrigin(options.origin);
        if (!options.allowedOrigins.map(toOrigin).includes(origin)) {
            throw new Error(`Safe App origin "${origin}" is not allowed.`);
        }
    }
    switch (request.method) {
        case 'getSafeInfo':
            return {
                safeAddress: safe.safeAddress,
                chainId: Number(safe.chainId),
                threshold: safe.threshold,
                owners: [...safe.owners],
                isReadOnly: options.safeInfo?.isReadOnly ?? false,
                nonce: options.safeInfo?.nonce ?? Number(safe.currentNonce),
                implementation: options.safeInfo?.implementation ?? ZERO_ADDRESS,
                modules: options.safeInfo?.modules === undefined
                    ? null
                    : options.safeInfo.modules === null
                        ? null
                        : [...options.safeInfo.modules],
                fallbackHandler: options.safeInfo?.fallbackHandler ?? null,
                guard: options.safeInfo?.guard ?? null,
                version: options.safeInfo?.version ?? null,
            };
        case 'getChainInfo':
            const blockExplorerUriTemplate = options.chainInfo?.blockExplorerUriTemplate;
            return {
                chainName: options.chainInfo?.chainName ?? `Chain ${String(safe.chainId)}`,
                chainId: String(safe.chainId),
                shortName: options.chainInfo?.shortName ?? String(safe.chainId),
                nativeCurrency: options.chainInfo?.nativeCurrency ?? {
                    name: 'Ether',
                    symbol: 'ETH',
                    decimals: 18,
                    logoUri: '',
                },
                blockExplorerUriTemplate: {
                    address: blockExplorerUriTemplate?.address ?? '',
                    txHash: blockExplorerUriTemplate?.txHash ?? blockExplorerUriTemplate?.tx ?? '',
                    api: blockExplorerUriTemplate?.api ?? '',
                },
            };
        case 'getEnvironmentInfo':
            return { origin: options.environmentOrigin ?? options.origin ?? 'null' };
        case 'sendTransactions': {
            const params = asRecord(request.params);
            const txs = params.txs;
            if (!Array.isArray(txs) || txs.length === 0) {
                throw new Error('Safe Apps sendTransactions requires a non-empty txs array.');
            }
            const normalizedTxs = txs.map(normalizeSafeAppTransaction);
            const safeTxGas = asRecord(params.params).safeTxGas;
            const transaction = normalizedTxs.length === 1
                ? {
                    to: normalizedTxs[0].to,
                    value: normalizedTxs[0].value,
                    data: normalizedTxs[0].data,
                    safeTxGas,
                }
                : {
                    to: assertAddress(options.multiSendAddress ?? SAFE_MULTISEND_CALL_ONLY_ADDRESS, 'Safe Apps multiSendAddress'),
                    value: '0',
                    data: encodeSafeMultiSendCall(normalizedTxs),
                    operation: 1,
                    safeTxGas,
                };
            const proposed = await safe.proposeTransaction({
                proposer: options.proposer,
                origin: typeof params.origin === 'string' ? params.origin : options.environmentOrigin,
                transaction,
            });
            return { safeTxHash: proposed.safeTxHash };
        }
        case 'getTxBySafeTxHash': {
            const params = asRecord(request.params);
            const safeTxHash = assertHex(String(params.safeTxHash), 'safeTxHash');
            const transaction = await safe.getTransaction(safeTxHash);
            return safeTransactionToGatewayDetails(transaction);
        }
        case 'rpcCall': {
            const params = asRecord(request.params);
            const method = String(params.call);
            if (method === 'safe_setSettings') {
                return Array.isArray(params.params) ? params.params[0] : params.params;
            }
            return safe.requestRpc({
                method,
                params: Array.isArray(params.params) ? params.params : [],
            });
        }
        case 'signMessage': {
            const params = asRecord(request.params);
            const message = String(params.message ?? '');
            const messageHash = keccak256(encodeAbiParameters([{ type: 'string' }], [message]));
            return {
                messageHash,
                signature: deterministicSafeSignature(messageHash, safe.owners[0]),
            };
        }
        case 'signTypedMessage': {
            const params = asRecord(request.params);
            const messageHash = keccak256(encodeAbiParameters([{ type: 'string' }], [JSON.stringify(params.typedData ?? {})]));
            return {
                messageHash,
                signature: deterministicSafeSignature(messageHash, safe.owners[0]),
            };
        }
        case 'getOffChainSignature': {
            const safeTxHash = assertHex(String(request.params ?? '0x'), 'message hash');
            return deterministicSafeSignature(safeTxHash, safe.owners[0]);
        }
        case 'wallet_getPermissions':
            return [...(options.permissions ?? [])];
        case 'wallet_requestPermissions':
            return [...(options.permissions ?? [])];
        case 'requestAddressBook':
            return [...(options.addressBook ?? [])];
        case 'getSafeBalances':
            return normalizeSafeAppBalances(options.balances);
        default:
            throw new Error(`Safe Apps SDK method "${request.method}" is not implemented.`);
    }
}
export async function injectSafeAppBridge(page, safe, options = {}) {
    const context = page.context();
    try {
        await context.exposeBinding(SAFE_APP_BRIDGE_BINDING, async (_source, payload) => {
            return handleSafeAppRequest(safe, payload.request, {
                ...options,
                origin: payload.origin,
            });
        });
    }
    catch (error) {
        if (error instanceof Error && /already registered/i.test(error.message)) {
            throw new Error('A Safe App bridge is already injected into this browser context. Create one bridge per context.', { cause: error });
        }
        throw error;
    }
    const script = buildSafeAppBridgeScript(options.version ?? '1.0.0');
    await context.addInitScript(script);
    await Promise.all(context.pages().map((target) => target.evaluate(script).catch(() => undefined)));
}
export function buildSafeAppBridgeScript(version = '1.0.0') {
    return `
(() => {
  if (window.__web3TesterSafeAppBridgeInstalled) return;
  Object.defineProperty(window, '__web3TesterSafeAppBridgeInstalled', {
    value: true,
    configurable: true,
  });

  const isSafeAppRequest = (data) =>
    data &&
    typeof data.id === 'string' &&
    typeof data.method === 'string' &&
    data.env &&
    typeof data.env.sdkVersion === 'string';

  window.addEventListener('message', async (event) => {
    if (!isSafeAppRequest(event.data)) return;
    const target = event.source;
    if (!target || typeof target.postMessage !== 'function') return;
    const targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
    try {
      const data = await window.${SAFE_APP_BRIDGE_BINDING}({
        request: event.data,
        origin: event.origin,
      });
      target.postMessage({ id: event.data.id, success: true, version: ${JSON.stringify(version)}, data }, targetOrigin);
    } catch (error) {
      target.postMessage({
        id: event.data.id,
        success: false,
        version: ${JSON.stringify(version)},
        error: error instanceof Error ? error.message : String(error),
      }, targetOrigin);
    }
  });
})();
`;
}
const sameAddress = (a, b) => a.toLowerCase() === b.toLowerCase();
const cloneTransaction = (transaction) => ({
    ...transaction,
    confirmations: transaction.confirmations.map((confirmation) => ({ ...confirmation })),
});
const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
const normalizeSafeAppTransaction = (value) => {
    const tx = asRecord(value);
    return {
        to: assertAddress(String(tx.to ?? ZERO_ADDRESS), 'Safe App transaction to'),
        value: decimal(tx.value),
        data: assertHex(String(tx.data ?? '0x'), 'Safe App transaction data'),
    };
};
const hexByteLength = (hex) => BigInt((hex.length - 2) / 2);
const encodeSafeMultiSendTransactions = (transactions) => {
    const packed = transactions
        .map((transaction) => [
        toHex(0, { size: 1 }).slice(2),
        transaction.to.slice(2).toLowerCase(),
        toHex(BigInt(transaction.value), { size: 32 }).slice(2),
        toHex(hexByteLength(transaction.data), { size: 32 }).slice(2),
        transaction.data.slice(2),
    ].join(''))
        .join('');
    return `0x${packed}`;
};
const encodeSafeMultiSendCall = (transactions) => {
    const encodedTransactions = encodeSafeMultiSendTransactions(transactions);
    const encodedArgument = encodeAbiParameters([{ type: 'bytes' }], [encodedTransactions]);
    return `${SAFE_MULTISEND_SELECTOR}${encodedArgument.slice(2)}`;
};
const normalizeSafeAppBalances = (balances) => {
    if (isSafeAppBalances(balances)) {
        return {
            fiatTotal: String(balances.fiatTotal),
            items: balances.items.map((item) => ({ ...item, tokenInfo: { ...item.tokenInfo } })),
        };
    }
    return {
        fiatTotal: '0',
        items: (balances ?? []).map((item) => ({ ...item, tokenInfo: { ...item.tokenInfo } })),
    };
};
const isSafeAppBalances = (balances) => Boolean(balances &&
    !Array.isArray(balances) &&
    typeof balances === 'object' &&
    'fiatTotal' in balances &&
    'items' in balances);
const safeTransactionToGatewayDetails = (transaction) => ({
    safeAddress: transaction.safeAddress,
    safeTxHash: transaction.safeTxHash,
    txHash: transaction.transactionHash,
    txStatus: transaction.isExecuted ? 'SUCCESS' : 'AWAITING_CONFIRMATIONS',
    txInfo: {
        type: 'Custom',
        to: { value: transaction.to },
        value: transaction.value,
        dataSize: transaction.data === '0x' ? '0' : String((transaction.data.length - 2) / 2),
    },
    txData: {
        hexData: transaction.data,
        to: { value: transaction.to },
        value: transaction.value,
        operation: transaction.operation,
    },
    detailedExecutionInfo: {
        type: 'MULTISIG',
        nonce: Number(BigInt(transaction.nonce)),
        confirmationsRequired: transaction.confirmationsRequired ?? transaction.confirmations.length,
        confirmationsSubmitted: transaction.confirmations.length,
        confirmations: transaction.confirmations.map((confirmation) => ({
            signer: { value: confirmation.owner },
            signature: confirmation.signature,
            submittedAt: confirmation.submissionDate,
        })),
    },
});
const toOrigin = (urlOrOrigin) => {
    try {
        return new URL(urlOrOrigin).origin;
    }
    catch {
        return urlOrOrigin;
    }
};
//# sourceMappingURL=safe.js.map