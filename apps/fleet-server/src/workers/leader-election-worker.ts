import type { FleetLeaderElection } from "@brash/application";

export interface LeaderElectionWorkerOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export class LeaderElectionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;

  constructor(private readonly election: FleetLeaderElection, private readonly options: LeaderElectionWorkerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 5_000;
    if (!Number.isInteger(this.intervalMs) || this.intervalMs < 250) throw new Error("Leader election interval must be at least 250ms.");
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.election.tick();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.election.stop();
  }
}
