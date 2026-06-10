import { createPublicClient, createWalletClient, hexToString, http, isAddress, } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
const normalizePrivateKey = (privateKey) => {
    const trimmed = privateKey.trim();
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
};
const asHex = (value) => typeof value === 'string' && value.startsWith('0x') ? value : undefined;
const normalizeMessage = (message) => {
    const hex = asHex(message);
    if (!hex) {
        return String(message ?? '');
    }
    try {
        return hexToString(hex);
    }
    catch {
        return { raw: hex };
    }
};
const parseParams = (request) => Array.isArray(request.params) ? [...request.params] : [];
export class PrivateKeyRpcClient {
    account;
    chain;
    sentTransactions = [];
    sentTransactionRequests = [];
    publicClient;
    walletClient;
    constructor(options) {
        this.chain = options.chain ?? sepolia;
        this.account = privateKeyToAccount(normalizePrivateKey(options.privateKey));
        const transport = http(options.rpcUrl);
        this.publicClient = createPublicClient({
            chain: this.chain,
            transport,
        });
        this.walletClient = createWalletClient({
            account: this.account,
            chain: this.chain,
            transport,
        });
    }
    async request(request) {
        const params = parseParams(request);
        switch (request.method) {
            case 'personal_sign': {
                const [first, second] = params;
                const message = typeof first === 'string' && isAddress(first) && second !== undefined
                    ? second
                    : first;
                return this.walletClient.signMessage({
                    account: this.account,
                    message: normalizeMessage(message),
                });
            }
            case 'eth_sign': {
                const [, message] = params;
                return this.walletClient.signMessage({
                    account: this.account,
                    message: normalizeMessage(message),
                });
            }
            case 'eth_signTypedData_v4': {
                const [, typedData] = params;
                const parsed = typeof typedData === 'string'
                    ? JSON.parse(typedData)
                    : typedData;
                return this.walletClient.signTypedData({
                    account: this.account,
                    domain: parsed.domain,
                    message: parsed.message,
                    primaryType: parsed.primaryType,
                    types: parsed.types,
                });
            }
            case 'eth_sendTransaction': {
                const [transaction] = params;
                if (!transaction) {
                    throw new Error('eth_sendTransaction requires a transaction object.');
                }
                const request = {
                    account: this.account,
                    chain: this.chain,
                    to: transaction.to,
                    data: transaction.data,
                    value: transaction.value ? BigInt(transaction.value) : undefined,
                    gas: transaction.gas ? BigInt(transaction.gas) : undefined,
                    gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : undefined,
                    nonce: transaction.nonce ? Number(BigInt(transaction.nonce)) : undefined,
                    maxFeePerGas: transaction.maxFeePerGas
                        ? BigInt(transaction.maxFeePerGas)
                        : undefined,
                    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
                        ? BigInt(transaction.maxPriorityFeePerGas)
                        : undefined,
                };
                const hash = await this.walletClient.sendTransaction(request);
                this.sentTransactions.push(hash);
                this.sentTransactionRequests.push({
                    hash,
                    to: transaction.to,
                    data: transaction.data,
                    value: transaction.value ? String(transaction.value) : undefined,
                });
                return hash;
            }
            default:
                return this.publicClient.request(request);
        }
    }
}
//# sourceMappingURL=private-key-rpc-client.js.map