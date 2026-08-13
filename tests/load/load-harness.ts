export interface LoadScenarioOptions<T> {
  name: string;
  totalOperations: number;
  concurrency: number;
  operation: (index: number) => Promise<T>;
}

export interface LoadScenarioReport<T> {
  name: string;
  totalOperations: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  throughputPerSecond: number;
  latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
  results: T[];
  errors: string[];
}

export async function runLoadScenario<T>(options: LoadScenarioOptions<T>): Promise<LoadScenarioReport<T>> {
  if (!Number.isInteger(options.totalOperations) || options.totalOperations < 1) throw new Error("totalOperations must be a positive integer.");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("concurrency must be a positive integer.");
  let cursor = 0;
  const latencies: number[] = [];
  const results: T[] = [];
  const errors: string[] = [];
  const startedAt = performance.now();

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= options.totalOperations) return;
      const operationStartedAt = performance.now();
      try {
        results.push(await options.operation(index));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        latencies.push(performance.now() - operationStartedAt);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.totalOperations) }, () => worker()));
  const durationMs = performance.now() - startedAt;
  latencies.sort((left, right) => left - right);
  return {
    name: options.name,
    totalOperations: options.totalOperations,
    succeeded: results.length,
    failed: errors.length,
    durationMs: rounded(durationMs),
    throughputPerSecond: rounded(options.totalOperations / Math.max(durationMs / 1_000, 0.001)),
    latencyMs: {
      min: rounded(latencies[0] ?? 0),
      p50: rounded(percentile(latencies, 0.5)),
      p95: rounded(percentile(latencies, 0.95)),
      p99: rounded(percentile(latencies, 0.99)),
      max: rounded(latencies.at(-1) ?? 0),
    },
    results,
    errors,
  };
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}
