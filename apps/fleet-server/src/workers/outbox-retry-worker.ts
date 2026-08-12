import type { FleetCore } from "@brash/application";

export interface OutboxRetryWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  onError?: (error: unknown) => void;
}

export class OutboxRetryWorker {
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly onError: (error: unknown) => void;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly core: FleetCore,
    options: OutboxRetryWorkerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 1_000;
    this.batchSize = options.batchSize ?? 25;
    this.onError = options.onError ?? ((error) => console.error("Outbox retry failed.", error));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.core.processPendingCommands(this.batchSize);
    } catch (error) {
      this.onError(error);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
