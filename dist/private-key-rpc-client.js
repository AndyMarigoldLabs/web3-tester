import { createPublicClient, createWalletClient, http, isAddress, } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
// Anvil/Hardhat chains are safe targets but viem does not mark them
// `testnet: true`, so they need their own allowlist entry.
const LOCAL_DEV_CHAIN_IDS = new Set([1337, 31337]);
const isTestChain = (chain) => chain.testnet === true || LOCAL_DEV_CHAIN_IDS.has(chain.id);
const normalizePrivateKey = (privateKey) => {
    const trimmed = privateKey.trim();
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
};
const asHex = (value) => typeof value === 'string' && value.startsWith('0x') ? value : undefined;
// Hex payloads must be signed as raw bytes: decoding to UTF-8 first corrupts
// binary messages (TextDecoder substitutes U+FFFD instead of throwing), and for
// valid UTF-8 text the EIP-191 digest over the raw bytes is identical anyway.
const normalizeMessage = (message) => {
    const hex = asHex(message);
    return hex ? { raw: hex } : String(message ?? '');
};
const parseParams = (request) => Array.isArray(request.params) ? [...request.params] : [];
export class PrivateKeyRpcClient {
    account;
    chain;
    sentTransactions = [];
    sentTransactionRequests = [];
    publicClient;
    walletClient;
    rpcChainVerified = false;
    constructor(options) {
        this.chain = options.chain ?? sepolia;
        if (!options.allowMainnet && !isTestChain(this.chain)) {
            throw new Error(`PrivateKeyRpcClient refuses chain "${this.chain.name}" (id ${this.chain.id}) because it is not marked as a testnet. ` +
                'This client signs and broadcasts without confirmation prompts. Pass allowMainnet: true to target a production chain, ' +
                'or use a chain definition with testnet: true.');
        }
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
            // Answered locally: the client holds exactly one key, and remote RPC
            // nodes answer [] (a needless network roundtrip that would also blind
            // MockWalletController's account validation in live mode).
            case 'eth_accounts':
                return [this.account.address];
            case 'personal_sign': {
                // Standard order is [message, address]; some legacy callers send
                // [address, message]. When both params are addresses the request is
                // ambiguous, so prefer the standard order and treat the first as the
                // message.
                const [first, second] = params;
                const firstIsAddress = typeof first === 'string' && isAddress(first);
                const secondIsAddress = typeof second === 'string' && isAddress(second);
                const message = firstIsAddress && !secondIsAddress && second !== undefined ? second : first;
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
            // v3 payloads (no arrays or recursive structs) hash identically under
            // v4 rules, so both versions share the same signing path.
            case 'eth_signTypedData_v3':
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
            case 'eth_signTypedData':
                throw new Error('eth_signTypedData (legacy v1) is not supported by PrivateKeyRpcClient. Use eth_signTypedData_v4.');
            // Also a broadcast — it must not slip past the chain check through the
            // default passthrough.
            case 'eth_sendRawTransaction': {
                await this.assertRpcChainMatches();
                const hash = (await this.publicClient.request(request));
                this.sentTransactions.push(hash);
                this.sentTransactionRequests.push({ hash });
                return hash;
            }
            case 'eth_sendTransaction': {
                const [transaction] = params;
                if (!transaction) {
                    throw new Error('eth_sendTransaction requires a transaction object.');
                }
                await this.assertRpcChainMatches();
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
    // A mismatched rpcUrl/chain pair must fail loudly before anything is
    // broadcast; success is cached, failures retry so a transient RPC error
    // does not poison the client.
    async assertRpcChainMatches() {
        if (this.rpcChainVerified) {
            return;
        }
        const reportedChainId = await this.publicClient.getChainId();
        if (reportedChainId !== this.chain.id) {
            throw new Error(`The RPC endpoint reports chain id ${reportedChainId} but this client is configured for "${this.chain.name}" (id ${this.chain.id}). ` +
                'Refusing to broadcast. Check the rpcUrl and chain options.');
        }
        this.rpcChainVerified = true;
    }
}
//# sourceMappingURL=private-key-rpc-client.js.map