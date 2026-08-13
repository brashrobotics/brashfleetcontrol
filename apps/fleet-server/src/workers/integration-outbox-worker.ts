import { randomUUID } from "node:crypto";
import type { IntegrationEventRepository } from "@brash/application";
import { IntegrationDeliveryError, type IntegrationEventPublisher } from "../modules/integrations/http-integration-publisher.js";

export interface IntegrationOutboxWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  batchSize?: number;
  leaseDurationMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxAttempts?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export class IntegrationOutboxWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseDurationMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly events: IntegrationEventRepository, private readonly publisher: IntegrationEventPublisher, options: IntegrationOutboxWorkerOptions = {}) {
    this.workerId = options.workerId ?? `integration-outbox-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.batchSize = options.batchSize ?? 25;
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.retryMaxMs = options.retryMaxMs ?? 300_000;
    this.maxAttempts = options.maxAttempts ?? 12;
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError ?? ((error) => console.error("Integration outbox delivery failed.", error));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce().catch(this.onError), this.pollIntervalMs);
    this.timer.unref?.();
    void this.runOnce().catch(this.onError);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimedAt = this.now();
      const claimed = await this.events.claimDue(this.batchSize, { workerId: this.workerId, claimedAt, leaseDurationMs: this.leaseDurationMs });
      for (const event of claimed) {
        try {
          const result = await this.publisher.publish(event);
          await this.events.recordDelivered(event.eventId, this.now(), result.status);
        } catch (error) {
          const attemptedAt = this.now();
          const retryMs = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.min(16, event.attemptCount)));
          const jitterMs = deterministicJitter(event.eventId, Math.max(1, Math.floor(retryMs * 0.2)));
          await this.events.recordFailure(
            event.eventId,
            attemptedAt,
            new Date(attemptedAt.getTime() + retryMs + jitterMs),
            error instanceof Error ? error.message : "Integration delivery failed.",
            this.maxAttempts,
            error instanceof IntegrationDeliveryError ? error.responseStatus : undefined,
          );
        }
      }
      return claimed.length;
    } finally {
      this.running = false;
    }
  }
}

function deterministicJitter(value: string, upperBound: number): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash % upperBound;
}
