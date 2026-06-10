import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createTestClient, http, publicActions, toHex, walletActions, } from 'viem';
import { foundry } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { TEST_ERC20_ABI, TEST_ERC20_BYTECODE } from './contracts/test-erc20.js';
import { dealErc20, getErc20Balance } from './erc20.js';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const EIP7702_DESIGNATOR_PREFIX = '0xef0100';
const toLocalAccount = (account) => typeof account === 'string' ? privateKeyToAccount(account) : account;
const DEFAULT_MNEMONIC = 'test test test test test test test test test test test junk';
const LOOPBACK_HOST_PATTERN = /^(127(\.\d{1,3}){3}|localhost|::1|\[::1\])$/i;
const DEFAULT_FOUNDRY_DOCKER_IMAGE = 'ghcr.io/foundry-rs/foundry:latest';
const CONTAINER_ANVIL_PORT = 8545;
const sleep = (ms, options = {}) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (options.unref) {
        timer.unref();
    }
});
const buildAnvilArgs = (options, host, port, chainId) => {
    const args = [
        '--host',
        host,
        '--port',
        String(port),
        '--chain-id',
        String(chainId),
        '--mnemonic',
        options.mnemonic ?? DEFAULT_MNEMONIC,
        '--accounts',
        String(options.accounts ?? 10),
        '--balance',
        String(options.balance ?? 10_000),
    ];
    if (options.blockTime !== undefined) {
        args.push('--block-time', String(options.blockTime));
    }
    if (options.forkUrl) {
        args.push('--fork-url', options.forkUrl);
    }
    if (options.forkBlockNumber !== undefined) {
        args.push('--fork-block-number', String(options.forkBlockNumber));
    }
    if (options.extraArgs) {
        args.push(...options.extraArgs);
    }
    return args;
};
const stopDockerContainer = async (containerName) => {
    const stopper = spawn('docker', ['stop', containerName], {
        stdio: 'ignore',
        windowsHide: true,
    });
    await Promise.race([
        once(stopper, 'exit').catch(() => undefined),
        once(stopper, 'error').catch(() => undefined),
        sleep(5_000, { unref: true }),
    ]);
};
export class AnvilInstance {
    process;
    containerName;
    host;
    port;
    chainId;
    rpcUrl;
    constructor(process, options, containerName) {
        this.process = process;
        this.containerName = containerName;
        this.host = options.host;
        this.port = options.port;
        this.chainId = options.chainId;
        this.rpcUrl = `http://${this.host}:${this.port}`;
    }
    static async start(options = {}) {
        const host = options.host ?? '127.0.0.1';
        // Anvil's --host is repeatable and accumulates, so a --host smuggled in
        // through extraArgs would bind every interface despite the loopback
        // default emitted first.
        const extraArgsOverrideHost = options.extraArgs?.some((arg) => arg === '--host' || arg.startsWith('--host='));
        if ((!LOOPBACK_HOST_PATTERN.test(host) || extraArgsOverrideHost) && !options.allowNonLoopbackHost) {
            throw new Error(extraArgsOverrideHost
                ? 'Pass the bind address through the `host` option, not extraArgs --host, so the loopback guard can validate it (or set allowNonLoopbackHost: true).'
                : `Anvil host "${host}" is not a loopback interface. A dev chain bound beyond loopback exposes its ` +
                    'unauthenticated admin RPC (impersonation, setBalance, any fork URL and its API key) to the network. ' +
                    'Pass allowNonLoopbackHost: true (ANVIL_ALLOW_NON_LOOPBACK=true with the bundled fixtures) if this is intentional.');
        }
        const port = options.port ?? 8545;
        const chainId = options.chainId ?? foundry.id;
        const runtime = options.runtime ?? 'binary';
        const executable = options.executable ?? process.env.ANVIL_EXECUTABLE ?? 'anvil';
        const dockerImage = options.dockerImage ?? DEFAULT_FOUNDRY_DOCKER_IMAGE;
        const containerName = runtime === 'docker'
            ? (options.containerName ?? `invisible-wallet-anvil-${port}-${Date.now()}`)
            : undefined;
        const timeoutMs = options.timeoutMs ?? 15_000;
        const command = runtime === 'docker'
            ? 'docker'
            : executable;
        const args = runtime === 'docker'
            ? [
                'run',
                '--rm',
                '--name',
                containerName,
                '-e',
                'FOUNDRY_DISABLE_NIGHTLY_WARNING=true',
                '-p',
                `${host}:${port}:${CONTAINER_ANVIL_PORT}`,
                '--entrypoint',
                'anvil',
                dockerImage,
                ...buildAnvilArgs(options, '0.0.0.0', CONTAINER_ANVIL_PORT, chainId),
            ]
            : buildAnvilArgs(options, host, port, chainId);
        const anvilProcess = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const instance = new AnvilInstance(anvilProcess, { host, port, chainId }, containerName);
        const logs = [];
        let capturingLogs = true;
        let listening = false;
        let spawnError;
        anvilProcess.once('error', (error) => {
            spawnError = error;
        });
        const handleOutput = (text) => {
            if (capturingLogs) {
                logs.push(text);
            }
            if (!listening && /Listening on/i.test(text)) {
                listening = true;
            }
        };
        anvilProcess.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            handleOutput(text);
            if (!options.silent) {
                process.stdout.write(text);
            }
        });
        anvilProcess.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            handleOutput(text);
            if (!options.silent) {
                process.stderr.write(text);
            }
        });
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (spawnError) {
                throw new Error(runtime === 'docker'
                    ? `Failed to start Anvil with Docker image "${dockerImage}". Make sure Docker Desktop is running and the image can be pulled.\n${spawnError.message}`
                    : `Failed to start Anvil executable "${executable}". Install Foundry or set ANVIL_EXECUTABLE to the Anvil binary path.\n${spawnError.message}`);
            }
            if (anvilProcess.exitCode !== null) {
                // The most common cause is the port being held by another process
                // (anvil fails to bind and exits), so surface that hint with the logs.
                throw new Error(`Anvil exited before it became ready with code ${anvilProcess.exitCode}. ` +
                    `If the logs mention the address being in use, another node is already running on port ${port}.\n${logs.join('')}`);
            }
            // Only probe the RPC endpoint after the spawned process itself reports
            // it is listening — probing earlier can succeed against a pre-existing
            // node on the same port and silently adopt the wrong chain.
            if (listening) {
                const reportedChainId = await instance.reportedChainId();
                if (reportedChainId !== undefined) {
                    if (reportedChainId !== chainId) {
                        await instance.stop();
                        throw new Error(`Anvil at ${instance.rpcUrl} reports chain id ${reportedChainId} but ${chainId} was requested. ` +
                            `Another node is likely running on port ${port}.`);
                    }
                    capturingLogs = false;
                    return instance;
                }
            }
            await sleep(100);
        }
        await instance.stop();
        throw new Error(`Timed out waiting for Anvil at ${instance.rpcUrl}.\n${logs.join('')}`);
    }
    async stop() {
        if (this.containerName) {
            await stopDockerContainer(this.containerName);
        }
        if (this.process.exitCode !== null) {
            return;
        }
        this.process.kill();
        const exited = await Promise.race([
            once(this.process, 'exit').then(() => true, () => true),
            sleep(5_000, { unref: true }).then(() => false),
        ]);
        if (!exited && this.process.exitCode === null) {
            this.process.kill('SIGKILL');
            await once(this.process, 'exit').catch(() => undefined);
        }
    }
    async reportedChainId() {
        try {
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    id: 1,
                    jsonrpc: '2.0',
                    method: 'eth_chainId',
                    params: [],
                }),
            });
            if (!response.ok) {
                return undefined;
            }
            const body = (await response.json());
            return typeof body.result === 'string' ? Number(BigInt(body.result)) : undefined;
        }
        catch {
            return undefined;
        }
    }
}
export class ChainController {
    rpcUrl;
    chainId;
    client;
    constructor(options) {
        this.rpcUrl = options.rpcUrl;
        this.chainId = options.chainId ?? foundry.id;
        this.client = createTestClient({
            chain: { ...foundry, id: this.chainId },
            mode: 'anvil',
            transport: http(this.rpcUrl),
        })
            .extend(publicActions)
            .extend(walletActions);
    }
    async snapshot() {
        return this.client.snapshot();
    }
    async revert(id) {
        await this.client.revert({ id });
    }
    async accounts() {
        return this.client.getAddresses();
    }
    async request(request) {
        return this.client.request(request);
    }
    async impersonateAccount(address) {
        await this.client.impersonateAccount({ address });
    }
    async stopImpersonatingAccount(address) {
        await this.client.stopImpersonatingAccount({ address });
    }
    async setBalance(address, value) {
        await this.client.setBalance({ address, value });
    }
    async fastForward(seconds) {
        await this.client.increaseTime({ seconds });
        await this.mine(1);
    }
    async mine(blocks = 1) {
        await this.client.mine({ blocks });
    }
    // ── Cheatcode-style helpers ─────────────────────────────────────────────
    // These bypass the wallet entirely (like forge cheatcodes): no approval
    // gating, no wallet.sentTransactions record.
    // Worker-lifetime: slot positions are code-determined, and dealErc20
    // verifies cache hits (with rediscovery) so address reuse after a
    // snapshot revert cannot corrupt state.
    erc20SlotCache = new Map();
    async deployContract(options) {
        const from = options.from ?? (await this.accounts())[0];
        if (!from) {
            throw new Error('Anvil did not expose any default accounts.');
        }
        const hash = await this.client.deployContract({
            abi: options.abi,
            bytecode: options.bytecode,
            args: options.args,
            account: from,
            value: options.value,
            chain: this.client.chain,
        });
        const receipt = await this.client.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success' || !receipt.contractAddress) {
            throw new Error(`Contract deployment reverted (tx ${hash}).`);
        }
        return { address: receipt.contractAddress, hash, receipt };
    }
    async deployErc20(options = {}) {
        const from = options.from ?? (await this.accounts())[0];
        if (!from) {
            throw new Error('Anvil did not expose any default accounts.');
        }
        const name = options.name ?? 'Test Token';
        const symbol = options.symbol ?? 'TEST';
        const decimals = options.decimals ?? 18;
        const initialSupply = options.initialSupply ?? 0n;
        const deployed = await this.deployContract({
            abi: TEST_ERC20_ABI,
            bytecode: TEST_ERC20_BYTECODE,
            args: [name, symbol, decimals, initialSupply, options.mintTo ?? from],
            from,
        });
        return { ...deployed, abi: TEST_ERC20_ABI, name, symbol, decimals };
    }
    /** forge-std deal parity: set any standard ERC-20 balance, fork included. */
    async dealErc20(token, account, amount, options) {
        return dealErc20(this, token, account, amount, options, this.erc20SlotCache);
    }
    async getErc20Balance(token, account) {
        return getErc20Balance(this, token, account);
    }
    async setStorageAt(address, slot, value) {
        await this.client.setStorageAt({
            address,
            index: toHex(BigInt(slot), { size: 32 }),
            value: toHex(BigInt(value), { size: 32 }),
        });
    }
    async setCode(address, bytecode) {
        await this.client.setCode({ address, bytecode });
    }
    async setNonce(address, nonce) {
        await this.client.setNonce({ address, nonce });
    }
    // ── EIP-7702 helpers ────────────────────────────────────────────────────
    // There is no anvil_signAuthorization RPC and viem signs authorizations
    // with local accounts only, hence the Account | private-key parameter
    // (anvil's default-mnemonic keys keep tests hermetic).
    async signAuthorization(options) {
        const account = toLocalAccount(options.account);
        return this.client.signAuthorization({
            account,
            contractAddress: options.contractAddress,
            nonce: options.nonce,
            chainId: options.chainId ?? this.chainId,
            executor: options.executor,
        });
    }
    /**
     * Signs and submits a type-4 delegation from an unlocked sponsor; resolves
     * once the authority's code is the 0xef0100‖address designator.
     */
    async delegate(options) {
        const authority = toLocalAccount(options.account);
        const sponsor = options.sponsor ?? (await this.accounts())[0];
        if (!sponsor) {
            throw new Error('Anvil did not expose any default accounts.');
        }
        const selfExecuting = sponsor.toLowerCase() === authority.address.toLowerCase();
        const authorization = await this.signAuthorization({
            account: authority,
            contractAddress: options.contractAddress,
            executor: selfExecuting ? 'self' : undefined,
        });
        // Raw eth_sendTransaction with an RPC-shaped (hex) authorizationList —
        // the sponsor is an unlocked anvil account, so the node signs the tx.
        const hash = (await this.request({
            method: 'eth_sendTransaction',
            params: [
                {
                    from: sponsor,
                    to: authority.address,
                    authorizationList: [
                        {
                            chainId: toHex(BigInt(authorization.chainId)),
                            address: authorization.address,
                            nonce: toHex(BigInt(authorization.nonce)),
                            yParity: toHex(BigInt(authorization.yParity ?? 0)),
                            r: authorization.r,
                            s: authorization.s,
                        },
                    ],
                },
            ],
        }));
        await this.client.waitForTransactionReceipt({ hash });
        return { hash, authority: authority.address };
    }
    /** Authorization to the zero address: resets the authority's code to 0x. */
    async revokeDelegation(options) {
        return this.delegate({ ...options, contractAddress: ZERO_ADDRESS });
    }
    /** Parses the EIP-7702 designator out of eth_getCode; null when not delegated. */
    async getDelegation(authority) {
        const code = await this.client.getCode({ address: authority });
        if (!code || !code.toLowerCase().startsWith(EIP7702_DESIGNATOR_PREFIX)) {
            return null;
        }
        return `0x${code.slice(EIP7702_DESIGNATOR_PREFIX.length)}`;
    }
}
//# sourceMappingURL=anvil.js.map