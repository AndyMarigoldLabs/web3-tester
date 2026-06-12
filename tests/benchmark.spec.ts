import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  benchmarkEnabled,
  benchmarkObjectMethods,
  createBenchmarkRecorder,
} from '../src/benchmark.js';
import { createBenchmarkRecorder as createBenchmarkRecorderFromRoot } from '../src/index.js';

test('benchmarkEnabled recognizes explicit opt-in values', () => {
  expect(benchmarkEnabled({ WEB3_TESTER_BENCHMARK: 'true' })).toBe(true);
  expect(benchmarkEnabled({ WEB3_TESTER_BENCHMARK: '1' })).toBe(true);
  expect(benchmarkEnabled({ WEB3_TESTER_BENCHMARK: 'false' })).toBe(false);
  expect(benchmarkEnabled({})).toBe(false);
});

test('root entry re-exports benchmark helpers', () => {
  expect(createBenchmarkRecorderFromRoot).toBe(createBenchmarkRecorder);
});

test('BenchmarkRecorder writes ndjson records and preserves return values', async ({}, testInfo) => {
  const outputPath = testInfo.outputPath('benchmark.ndjson');
  const recorder = createBenchmarkRecorder({
    enabled: true,
    outputPath,
    suite: 'benchmark-unit',
    testInfo,
  });

  const result = await recorder.measure('unit.step', async () => 42, { phase: 'unit' });
  await recorder.flush();

  expect(result).toBe(42);
  const [line] = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
  const record = JSON.parse(line!);
  expect(record).toMatchObject({
    metadata: { phase: 'unit' },
    name: 'unit.step',
    status: 'passed',
    suite: 'benchmark-unit',
  });
  expect(record.durationMs).toBeGreaterThanOrEqual(0);
});

test('benchmarkObjectMethods measures proxied methods', async ({}, testInfo) => {
  const outputPath = testInfo.outputPath('proxy-benchmark.ndjson');
  const recorder = createBenchmarkRecorder({ enabled: true, outputPath, testInfo });
  const target = {
    async add(left: number, right: number) {
      return left + right;
    },
    value: 7,
  };

  const proxy = benchmarkObjectMethods(target, recorder, { prefix: 'target' });

  expect(await proxy.add(2, 3)).toBe(5);
  expect(proxy.value).toBe(7);

  const record = JSON.parse(fs.readFileSync(outputPath, 'utf8').trim());
  expect(record).toMatchObject({
    name: 'target.add',
    status: 'passed',
  });
});
