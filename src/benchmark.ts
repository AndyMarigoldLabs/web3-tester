import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { TestInfo } from '@playwright/test';

export const WEB3_TESTER_BENCHMARK_ENV = 'WEB3_TESTER_BENCHMARK';
export const WEB3_TESTER_BENCHMARK_OUTPUT_ENV = 'WEB3_TESTER_BENCHMARK_OUTPUT';
export const WEB3_TESTER_BENCHMARK_VERBOSE_ENV = 'WEB3_TESTER_BENCHMARK_VERBOSE';

export type BenchmarkMetadata = Record<string, string | number | boolean | null | undefined>;

export type BenchmarkRecord = {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  startedAt: string;
  endedAt: string;
  suite?: string;
  metadata?: BenchmarkMetadata;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  test?: {
    title: string;
    project?: string;
    workerIndex?: number;
    retry?: number;
  };
};

export type BenchmarkRecorderOptions = {
  enabled?: boolean;
  outputPath?: string;
  suite?: string;
  testInfo?: Pick<TestInfo, 'attach' | 'outputPath' | 'project' | 'retry' | 'title' | 'titlePath' | 'workerIndex'>;
};

const testRecorders = new WeakMap<object, BenchmarkRecorder>();

export function benchmarkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[WEB3_TESTER_BENCHMARK_ENV]?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function benchmarkOutputPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(
    env[WEB3_TESTER_BENCHMARK_OUTPUT_ENV] ?? path.join(process.cwd(), 'reports', 'web3-tester-benchmark.ndjson'),
  );
}

export class BenchmarkRecorder {
  readonly enabled: boolean;
  readonly records: BenchmarkRecord[] = [];

  private attached = false;
  private readonly outputPath?: string;
  private readonly suite?: string;
  private readonly testInfo?: BenchmarkRecorderOptions['testInfo'];

  constructor(options: BenchmarkRecorderOptions = {}) {
    this.enabled = options.enabled ?? benchmarkEnabled();
    this.outputPath = options.outputPath ?? (this.enabled ? benchmarkOutputPath() : undefined);
    this.suite = options.suite;
    this.testInfo = options.testInfo;
  }

  async measure<T>(
    name: string,
    action: () => T | Promise<T>,
    metadata?: BenchmarkMetadata,
  ): Promise<T> {
    if (!this.enabled) return action();

    const startedAt = new Date();
    const started = performance.now();
    try {
      const result = await action();
      this.record({
        durationMs: performance.now() - started,
        endedAt: new Date().toISOString(),
        metadata,
        name,
        startedAt: startedAt.toISOString(),
        status: 'passed',
      });
      return result;
    } catch (error) {
      this.record({
        durationMs: performance.now() - started,
        endedAt: new Date().toISOString(),
        error: serializeBenchmarkError(error),
        metadata,
        name,
        startedAt: startedAt.toISOString(),
        status: 'failed',
      });
      throw error;
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled || this.attached || !this.testInfo || this.records.length === 0) return;
    this.attached = true;
    const body = JSON.stringify(this.records, null, 2);
    await this.testInfo
      .attach('web3-tester-benchmark.json', {
        body,
        contentType: 'application/json',
      })
      .catch(() => undefined);
  }

  private record(record: Omit<BenchmarkRecord, 'suite' | 'test'>): void {
    const fullRecord: BenchmarkRecord = {
      ...record,
      durationMs: Number(record.durationMs.toFixed(2)),
      suite: this.suite,
      test: this.testInfo
        ? {
            project: this.testInfo.project?.name,
            retry: this.testInfo.retry,
            title: benchmarkTestTitle(this.testInfo),
            workerIndex: this.testInfo.workerIndex,
          }
        : undefined,
    };
    this.records.push(fullRecord);
    appendBenchmarkRecord(fullRecord, this.outputPath);

    if (process.env[WEB3_TESTER_BENCHMARK_VERBOSE_ENV] === 'true') {
      process.stderr.write(
        `[web3-tester benchmark] ${fullRecord.name} ${fullRecord.status} ${fullRecord.durationMs}ms\n`,
      );
    }
  }
}

export function createBenchmarkRecorder(options: BenchmarkRecorderOptions = {}): BenchmarkRecorder {
  return new BenchmarkRecorder(options);
}

export function benchmarkForTest(
  testInfo: BenchmarkRecorderOptions['testInfo'],
  options: Omit<BenchmarkRecorderOptions, 'testInfo'> = {},
): BenchmarkRecorder {
  if (!testInfo) return createBenchmarkRecorder(options);

  const existing = testRecorders.get(testInfo);
  if (existing) return existing;

  const recorder = createBenchmarkRecorder({ ...options, testInfo });
  testRecorders.set(testInfo, recorder);
  return recorder;
}

export async function benchmarkStep<T>(
  testInfo: BenchmarkRecorderOptions['testInfo'] | undefined,
  name: string,
  action: () => T | Promise<T>,
  metadata?: BenchmarkMetadata,
): Promise<T> {
  return benchmarkForTest(testInfo, { suite: 'test' }).measure(name, action, metadata);
}

export async function flushBenchmark(testInfo: BenchmarkRecorderOptions['testInfo'] | undefined): Promise<void> {
  if (!testInfo) return;
  await benchmarkForTest(testInfo).flush();
}

export function benchmarkObjectMethods<T extends object>(
  target: T,
  recorder: BenchmarkRecorder,
  options: {
    prefix?: string;
    include?: readonly string[];
    exclude?: readonly string[];
  } = {},
): T {
  if (!recorder.enabled) return target;

  const include = options.include ? new Set(options.include) : undefined;
  const exclude = new Set(options.exclude ?? []);
  const prefix = options.prefix ? `${options.prefix}.` : '';
  const wrapped = new Map<PropertyKey, unknown>();

  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof property !== 'string' || typeof value !== 'function') return value;
      if (include && !include.has(property)) return value.bind(object);
      if (exclude.has(property)) return value.bind(object);
      if (wrapped.has(property)) return wrapped.get(property);

      const measured = (...args: unknown[]) =>
        recorder.measure(`${prefix}${property}`, () => value.apply(object, args));
      wrapped.set(property, measured);
      return measured;
    },
  });
}

function appendBenchmarkRecord(record: BenchmarkRecord, outputPath: string | undefined): void {
  if (!outputPath) return;
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.appendFileSync(outputPath, `${JSON.stringify(record)}\n`);
  } catch {
    // Benchmarks are diagnostic-only and must never alter test behavior.
  }
}

function benchmarkTestTitle(testInfo: NonNullable<BenchmarkRecorderOptions['testInfo']>): string {
  const titlePath = (testInfo as { titlePath?: unknown }).titlePath;
  if (Array.isArray(titlePath)) return titlePath.join(' > ');
  if (typeof titlePath === 'function') {
    const value = titlePath();
    if (Array.isArray(value)) return value.join(' > ');
  }
  return testInfo.title;
}

function serializeBenchmarkError(error: unknown): BenchmarkRecord['error'] {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}
