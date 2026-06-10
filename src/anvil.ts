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
}
