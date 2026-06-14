import type { TestInfo } from '@playwright/test';
export declare const WEB3_TESTER_BENCHMARK_ENV = "WEB3_TESTER_BENCHMARK";
export declare const WEB3_TESTER_BENCHMARK_OUTPUT_ENV = "WEB3_TESTER_BENCHMARK_OUTPUT";
export declare const WEB3_TESTER_BENCHMARK_VERBOSE_ENV = "WEB3_TESTER_BENCHMARK_VERBOSE";
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
export declare function benchmarkEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function benchmarkOutputPath(env?: NodeJS.ProcessEnv): string;
export declare class BenchmarkRecorder {
    readonly enabled: boolean;
    readonly records: BenchmarkRecord[];
    private attached;
    private readonly outputPath?;
    private readonly suite?;
    private readonly testInfo?;
    constructor(options?: BenchmarkRecorderOptions);
    measure<T>(name: string, action: () => T | Promise<T>, metadata?: BenchmarkMetadata): Promise<T>;
    flush(): Promise<void>;
    private record;
}
export declare function createBenchmarkRecorder(options?: BenchmarkRecorderOptions): BenchmarkRecorder;
export declare function benchmarkForTest(testInfo: BenchmarkRecorderOptions['testInfo'], options?: Omit<BenchmarkRecorderOptions, 'testInfo'>): BenchmarkRecorder;
export declare function benchmarkStep<T>(testInfo: BenchmarkRecorderOptions['testInfo'] | undefined, name: string, action: () => T | Promise<T>, metadata?: BenchmarkMetadata): Promise<T>;
export declare function flushBenchmark(testInfo: BenchmarkRecorderOptions['testInfo'] | undefined): Promise<void>;
export declare function benchmarkObjectMethods<T extends object>(target: T, recorder: BenchmarkRecorder, options?: {
    prefix?: string;
    include?: readonly string[];
    exclude?: readonly string[];
}): T;
//# sourceMappingURL=benchmark.d.ts.map