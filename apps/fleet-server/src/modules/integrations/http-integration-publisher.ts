import { createHmac } from "node:crypto";
import type { IntegrationEventRecord } from "@brash/application";

export interface IntegrationEventPublisher {
  publish(event: IntegrationEventRecord): Promise<{ status: number }>;
}

export interface HttpIntegrationPublisherOptions {
  endpoint: string;
  signingSecret?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  production?: boolean;
}

export class HttpIntegrationEventPublisher implements IntegrationEventPublisher {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: HttpIntegrationPublisherOptions) {
    this.endpoint = new URL(options.endpoint);
    if ((options.production ?? process.env.NODE_ENV === "production") && this.endpoint.protocol !== "https:") {
      throw new Error("Production integration webhooks must use HTTPS.");
    }
    if (options.signingSecret && Buffer.byteLength(options.signingSecret, "utf8") < 32) {
      throw new Error("Integration webhook signing secret must contain at least 32 bytes.");
    }
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) throw new Error("Integration webhook timeout must be between 100 and 120000 ms.");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async publish(event: IntegrationEventRecord): Promise<{ status: number }> {
    const body = JSON.stringify({
      schemaVersion: "1.0",
      eventId: event.eventId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": event.idempotencyKey,
      "x-brash-event-id": event.eventId,
      "x-brash-event-type": event.eventType,
    };
    if (this.options.signingSecret) {
      headers["x-brash-signature-256"] = `sha256=${createHmac("sha256", this.options.signingSecret).update(body).digest("hex")}`;
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new IntegrationDeliveryError(error instanceof Error ? error.message : "Webhook transport failed.");
    }
    if (!response.ok) throw new IntegrationDeliveryError(`Webhook returned HTTP ${response.status}.`, response.status);
    return { status: response.status };
  }
}

export class IntegrationDeliveryError extends Error {
  constructor(message: string, readonly responseStatus?: number) {
    super(message);
    this.name = "IntegrationDeliveryError";
  }
}
