import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import {
  createTestClient,
  http,
  publicActions,
  toHex,
  walletActions,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicActions,
  type TestClient,
  type TransactionReceipt,
  type Transport,
  type WalletActions,
} from 'viem';
import { foundry } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { Account, SignedAuthorization } from 'viem';
import { TEST_ERC20_ABI, TEST_ERC20_BYTECODE } from './contracts/test-erc20.js';
import { dealErc20, getErc20Balance, type DealErc20Options, type Erc20SlotInfo } from './erc20.js';
import {
  waitForDecodedTransaction,
  type DecodedTransaction,
  type ReadClient,
} from './transactions.js';
import type { JsonRpcRequest, RpcClient } from './types.js';

export type DeployContractOptions = {
  abi: Abi;
  bytecode: Hex;
  args?: readonly unknown[];
  /** Defaults to the first Anvil unlocked account. */
  from?: Address;
  value?: bigint;
};

export type DeployedContract = {
  address: Address;
  hash: Hex;
  receipt: TransactionReceipt;
};

export type DeployErc20Options = {
  name?: string;
  symbol?: string;
  decimals?: number;
  /** Minted to mintTo in the constructor. Default 0n. */
  initialSupply?: bigint;
  /** Defaults to the deployer. */
  mintTo?: Address;
  from?: Address;
};

export type DeployedErc20 = DeployedContract & {
  abi: typeof TEST_ERC20_ABI;
  name: string;
  symbol: string;
  decimals: number;
};

export type ChainAuthorizationOptions = {
  /** Authority: a viem local account or a raw private key. */
  account: Account | Hex;
  /** The delegate contract; the zero address revokes. */
  contractAddress: Address;
  nonce?: number;
  /** Default: this chain's id. 0 = valid on any chain. */
  chainId?: number;
  /** 'self' when the authority submits its own type-4 tx (nonce+1 rules). */
  executor?: 'self';
};

export type DelegateOptions = {
  /** Authority whose key signs the authorization. */
  account: Account | Hex;
  contractAddress: Address;
  /** Unlocked anvil account paying gas. Default: accounts()[0]. */
  sponsor?: Address;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const EIP7702_DESIGNATOR_PREFIX = '0xef0100';

const toLocalAccount = (account: Account | Hex): Account =>
  typeof account === 'string' ? privateKeyToAccount(account) : account;

export type AnvilOptions = {
  runtime?: 'binary' | 'docker';
  executable?: string;
  dockerImage?: string;
  containerName?: string;
  host?: string;
  port?: number;
  chainId?: number;
  accounts?: number;
  balance?: number;
  mnemonic?: string;
  blockTime?: number;
  forkUrl?: string;
  forkBlockNumber?: number;
  extraArgs?: readonly string[];
  timeoutMs?: number;
  silent?: boolean;
  /** Opt in to binding Anvil to a non-loopback interface. */
  allowNonLoopbackHost?: boolean;
};

export type AnvilSnapshotId = Hex;
export type AnvilViemClient = TestClient<'anvil', Transport, Chain> &
  PublicActions<Transport, Chain> &
  WalletActions<Chain>;

const DEFAULT_MNEMONIC =
  'test test test test test test test test test test test junk';
const LOOPBACK_HOST_PATTERN = /^(127(\.\d{1,3}){3}|localhost|::1|\[::1\])$/i;
const DEFAULT_FOUNDRY_DOCKER_IMAGE = 'ghcr.io/foundry-rs/foundry:latest';
const CONTAINER_ANVIL_PORT = 8545;

const sleep = (ms: number, options: { unref?: boolean } = {}) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (options.unref) {
      timer.unref();
    }
  });

type AnvilProcess = ChildProcessByStdio<null, Readable, Readable>;

const buildAnvilArgs = (
  options: AnvilOptions,
  host: string,
  port: number,
  chainId: number,
): string[] => {
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

const stopDockerContainer = async (containerName: string): Promise<void> => {
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
  readonly host: string;
  readonly port: number;
  readonly chainId: number;
  readonly rpcUrl: string;

  private constructor(
    private readonly process: AnvilProcess,
    options: Required<Pick<AnvilOptions, 'host' | 'port' | 'chainId'>>,
    private readonly containerName?: string,
  ) {
    this.host = options.host;
    this.port = options.port;
    this.chainId = options.chainId;
    this.rpcUrl = `http://${this.host}:${this.port}`;
  }

  static async start(options: AnvilOptions = {}): Promise<AnvilInstance> {
    const host = options.host ?? '127.0.0.1';
    // Anvil's --host is repeatable and accumulates, so a --host smuggled in
    // through extraArgs would bind every interface despite the loopback
    // default emitted first.
    const extraArgsOverrideHost = options.extraArgs?.some(
      (arg) => arg === '--host' || arg.startsWith('--host='),
    );
    if ((!LOOPBACK_HOST_PATTERN.test(host) || extraArgsOverrideHost) && !options.allowNonLoopbackHost) {
      throw new Error(
        extraArgsOverrideHost
          ? 'Pass the bind address through the `host` option, not extraArgs --host, so the loopback guard can validate it (or set allowNonLoopbackHost: true).'
          : `Anvil host "${host}" is not a loopback interface. A dev chain bound beyond loopback exposes its ` +
            'unauthenticated admin RPC (impersonation, setBalance, any fork URL and its API key) to the network. ' +
            'Pass allowNonLoopbackHost: true (ANVIL_ALLOW_NON_LOOPBACK=true with the bundled fixtures) if this is intentional.',
      );
    }
    const port = options.port ?? 8545;
    const chainId = options.chainId ?? foundry.id;
    const runtime = options.runtime ?? 'binary';
    const executable = options.executable ?? process.env.ANVIL_EXECUTABLE ?? 'anvil';
    const dockerImage = options.dockerImage ?? DEFAULT_FOUNDRY_DOCKER_IMAGE;
    const containerName =
      runtime === 'docker'
        ? (options.containerName ?? `invisible-wallet-anvil-${port}-${Date.now()}`)
        : undefined;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const command =
      runtime === 'docker'
        ? 'docker'
        : executable;
    const args =
      runtime === 'docker'
        ? [
            'run',
            '--rm',
            '--name',
            containerName!,
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
    const logs: string[] = [];
    let capturingLogs = true;
    let listening = false;
    let spawnError: Error | undefined;

    anvilProcess.once('error', (error) => {
      spawnError = error;
    });

    const handleOutput = (text: string) => {
      if (capturingLogs) {
        logs.push(text);
      }
      if (!listening && /Listening on/i.test(text)) {
        listening = true;
      }
    };

    anvilProcess.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      handleOutput(text);
      if (!options.silent) {
        process.stdout.write(text);
      }
    });

    anvilProcess.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      handleOutput(text);
      if (!options.silent) {
        process.stderr.write(text);
      }
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(
          runtime === 'docker'
            ? `Failed to start Anvil with Docker image "${dockerImage}". Make sure Docker Desktop is running and the image can be pulled.\n${spawnError.message}`
            : `Failed to start Anvil executable "${executable}". Install Foundry or set ANVIL_EXECUTABLE to the Anvil binary path.\n${spawnError.message}`,
        );
      }

      if (anvilProcess.exitCode !== null) {
        // The most common cause is the port being held by another process
        // (anvil fails to bind and exits), so surface that hint with the logs.
        throw new Error(
          `Anvil exited before it became ready with code ${anvilProcess.exitCode}. ` +
            `If the logs mention the address being in use, another node is already running on port ${port}.\n${logs.join('')}`,
        );
      }

      // Only probe the RPC endpoint after the spawned process itself reports
      // it is listening — probing earlier can succeed against a pre-existing
      // node on the same port and silently adopt the wrong chain.
      if (listening) {
        const reportedChainId = await instance.reportedChainId();
        if (reportedChainId !== undefined) {
          if (reportedChainId !== chainId) {
            await instance.stop();
            throw new Error(
              `Anvil at ${instance.rpcUrl} reports chain id ${reportedChainId} but ${chainId} was requested. ` +
                `Another node is likely running on port ${port}.`,
            );
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

  async stop(): Promise<void> {
    if (this.containerName) {
      await stopDockerContainer(this.containerName);
    }

    if (this.process.exitCode !== null) {
      return;
    }

    this.process.kill();
    const exited = await Promise.race([
      once(this.process, 'exit').then(
        () => true,
        () => true,
      ),
      sleep(5_000, { unref: true }).then(() => false),
    ]);

    if (!exited && this.process.exitCode === null) {
      this.process.kill('SIGKILL');
      await once(this.process, 'exit').catch(() => undefined);
    }
  }

  private async reportedChainId(): Promise<number | undefined> {
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

      const body = (await response.json()) as { result?: unknown };
      return typeof body.result === 'string' ? Number(BigInt(body.result)) : undefined;
    } catch {
      return undefined;
    }
  }
}

export type ChainControllerOptions = {
  rpcUrl: string;
  chainId?: number;
};

export class ChainController implements RpcClient {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly client: AnvilViemClient;

  constructor(options: ChainControllerOptions) {
    this.rpcUrl = options.rpcUrl;
    this.chainId = options.chainId ?? foundry.id;
    this.client = createTestClient({
      chain: { ...foundry, id: this.chainId },
      mode: 'anvil',
      transport: http(this.rpcUrl),
    })
      .extend(publicActions)
      .extend(walletActions) as AnvilViemClient;
  }

  async snapshot(): Promise<AnvilSnapshotId> {
    return this.client.snapshot();
  }

  async revert(id: AnvilSnapshotId): Promise<void> {
    await this.client.revert({ id });
  }

  async accounts(): Promise<Address[]> {
    return this.client.getAddresses();
  }

  async request(request: JsonRpcRequest): Promise<unknown> {
    return this.client.request(request as never);
  }

  async impersonateAccount(address: Address): Promise<void> {
    await this.client.impersonateAccount({ address });
  }

  async stopImpersonatingAccount(address: Address): Promise<void> {
    await this.client.stopImpersonatingAccount({ address });
  }

  async setBalance(address: Address, value: bigint): Promise<void> {
    await this.client.setBalance({ address, value });
  }

  async fastForward(seconds: number): Promise<void> {
    await this.client.increaseTime({ seconds });
    await this.mine(1);
  }

  async mine(blocks = 1): Promise<void> {
    await this.client.mine({ blocks });
  }

  /**
   * Waits for the receipt and returns it with decoded logs (when an abi is
   * given) and, for reverted transactions, the recovered revert reason.
   */
  async waitForTransaction(
    hash: Hex,
    options?: { abi?: Abi; timeoutMs?: number },
  ): Promise<DecodedTransaction> {
    return waitForDecodedTransaction(this.client as unknown as ReadClient, hash, options);
  }

  // ── Cheatcode-style helpers ─────────────────────────────────────────────
  // These bypass the wallet entirely (like forge cheatcodes): no approval
  // gating, no wallet.sentTransactions record.

  // Worker-lifetime: slot positions are code-determined, and dealErc20
  // verifies cache hits (with rediscovery) so address reuse after a
  // snapshot revert cannot corrupt state.
  private readonly erc20SlotCache = new Map<string, Erc20SlotInfo>();

  async deployContract(options: DeployContractOptions): Promise<DeployedContract> {
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
    } as never);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error(`Contract deployment reverted (tx ${hash}).`);
    }

    return { address: receipt.contractAddress, hash, receipt };
  }

  async deployErc20(options: DeployErc20Options = {}): Promise<DeployedErc20> {
    const from = options.from ?? (await this.accounts())[0];
    if (!from) {
      throw new Error('Anvil did not expose any default accounts.');
    }

    const name = options.name ?? 'Test Token';
    const symbol = options.symbol ?? 'TEST';
    const decimals = options.decimals ?? 18;
    const initialSupply = options.initialSupply ?? 0n;

    const deployed = await this.deployContract({
      abi: TEST_ERC20_ABI as unknown as Abi,
      bytecode: TEST_ERC20_BYTECODE,
      args: [name, symbol, decimals, initialSupply, options.mintTo ?? from],
      from,
    });

    return { ...deployed, abi: TEST_ERC20_ABI, name, symbol, decimals };
  }

  /** forge-std deal parity: set any standard ERC-20 balance, fork included. */
  async dealErc20(
    token: Address,
    account: Address,
    amount: bigint,
    options?: DealErc20Options,
  ): Promise<void> {
    return dealErc20(this, token, account, amount, options, this.erc20SlotCache);
  }

  async getErc20Balance(token: Address, account: Address): Promise<bigint> {
    return getErc20Balance(this, token, account);
  }

  async setStorageAt(address: Address, slot: Hex | bigint | number, value: Hex | bigint): Promise<void> {
    await this.client.setStorageAt({
      address,
      index: toHex(BigInt(slot), { size: 32 }) as Hex & { length: 66 },
      value: toHex(BigInt(value), { size: 32 }),
    });
  }

  async setCode(address: Address, bytecode: Hex): Promise<void> {
    await this.client.setCode({ address, bytecode });
  }

  async setNonce(address: Address, nonce: number): Promise<void> {
    await this.client.setNonce({ address, nonce });
  }

  // ── EIP-7702 helpers ────────────────────────────────────────────────────
  // There is no anvil_signAuthorization RPC and viem signs authorizations
  // with local accounts only, hence the Account | private-key parameter
  // (anvil's default-mnemonic keys keep tests hermetic).

  async signAuthorization(options: ChainAuthorizationOptions): Promise<SignedAuthorization> {
    const account = toLocalAccount(options.account);
    return this.client.signAuthorization({
      account,
      contractAddress: options.contractAddress,
      nonce: options.nonce,
      chainId: options.chainId ?? this.chainId,
      executor: options.executor,
    } as never);
  }

  /**
   * Signs and submits a type-4 delegation from an unlocked sponsor; resolves
   * once the authority's code is the 0xef0100‖address designator.
   */
  async delegate(options: DelegateOptions): Promise<{ hash: Hex; authority: Address }> {
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
    })) as Hex;

    await this.client.waitForTransactionReceipt({ hash });
    return { hash, authority: authority.address };
  }

  /** Authorization to the zero address: resets the authority's code to 0x. */
  async revokeDelegation(
    options: Omit<DelegateOptions, 'contractAddress'>,
  ): Promise<{ hash: Hex; authority: Address }> {
    return this.delegate({ ...options, contractAddress: ZERO_ADDRESS });
  }

  /** Parses the EIP-7702 designator out of eth_getCode; null when not delegated. */
  async getDelegation(authority: Address): Promise<Address | null> {
    const code = await this.client.getCode({ address: authority });
    if (!code || !code.toLowerCase().startsWith(EIP7702_DESIGNATOR_PREFIX)) {
      return null;
    }
    return `0x${code.slice(EIP7702_DESIGNATOR_PREFIX.length)}` as Address;
  }
}
