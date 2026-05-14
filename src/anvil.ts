import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import {
  createTestClient,
  http,
  publicActions,
  walletActions,
  type Address,
  type Chain,
  type Hex,
  type PublicActions,
  type TestClient,
  type Transport,
  type WalletActions,
} from 'viem';
import { foundry } from 'viem/chains';
import type { JsonRpcRequest, RpcClient } from './types.js';

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
  timeoutMs?: number;
  silent?: boolean;
};

export type AnvilSnapshotId = Hex;
export type AnvilViemClient = TestClient<'anvil', Transport, Chain> &
  PublicActions<Transport, Chain> &
  WalletActions<Chain>;

const DEFAULT_MNEMONIC =
  'test test test test test test test test test test test junk';
const DEFAULT_FOUNDRY_DOCKER_IMAGE = 'ghcr.io/foundry-rs/foundry:latest';
const CONTAINER_ANVIL_PORT = 8545;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    sleep(5_000),
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
    let spawnError: Error | undefined;

    anvilProcess.once('error', (error) => {
      spawnError = error;
    });

    anvilProcess.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      logs.push(text);
      if (!options.silent) {
        process.stdout.write(text);
      }
    });

    anvilProcess.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      logs.push(text);
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
        throw new Error(
          `Anvil exited before it became ready with code ${anvilProcess.exitCode}.\n${logs.join('')}`,
        );
      }

      if (await instance.isReady()) {
        return instance;
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
    await once(this.process, 'exit').catch(() => undefined);
  }

  private async isReady(): Promise<boolean> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'web3_clientVersion',
          params: [],
        }),
      });

      return response.ok;
    } catch {
      return false;
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
}
