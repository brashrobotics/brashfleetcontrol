import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { IntegrationEventRecord } from "@brash/application";
import { InMemoryIntegrationEventRepository } from "@brash/persistence";
import { createTestFleetSystem } from "@brash/test-kit";
import { HttpIntegrationEventPublisher, IntegrationDeliveryError, type IntegrationEventPublisher } from "../../apps/fleet-server/src/modules/integrations/http-integration-publisher.js";
import { IntegrationOutboxWorker } from "../../apps/fleet-server/src/workers/integration-outbox-worker.js";

const workOrder = {
  name: "ERP pallet delivery",
  externalReference: "ERP-INTEGRATION-001",
  priority: 80,
  requiredCapabilities: ["pallet_transport"],
  payloadKg: 250,
  pickup: { stationId: "WAREHOUSE-A", mapId: "plant-a@1", x: 10, y: 5, zoneId: "warehouse" },
  dropoff: { stationId: "ASSEMBLY-02", mapId: "plant-a@1", x: 70, y: 25, zoneId: "production" },
};

test("work-order state and integration events are persisted with stable idempotency keys", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const created = await system.core.createWorkOrder(workOrder);
    const duplicate = await system.core.createWorkOrder(workOrder);
    assert.equal(duplicate.workOrderId, created.workOrderId);
    const events = await system.core.listIntegrationEvents({ aggregateId: created.workOrderId });
    assert.deepEqual(events.map((event) => event.eventType).sort(), ["WORK_ORDER_ALLOCATED", "WORK_ORDER_CREATED"]);
    assert.equal(new Set(events.map((event) => event.idempotencyKey)).size, 2);
    assert.ok(events.every((event) => event.payload.workOrderId === created.workOrderId && event.status === "PENDING"));
  } finally {
    await system.core.stop();
  }
});

test("integration worker retries ambiguous failures and dead-letters poison events", async () => {
  const repository = new InMemoryIntegrationEventRepository();
  const now = new Date("2026-08-13T12:00:00.000Z");
  const first = eventFixture("EVENT-1", now);
  await repository.enqueue(first);
  let publishCalls = 0;
  const publisher: IntegrationEventPublisher = {
    async publish() {
      publishCalls += 1;
      if (publishCalls === 1) throw new IntegrationDeliveryError("Temporary ERP outage.", 503);
      return { status: 204 };
    },
  };
  let current = new Date(now);
  const worker = new IntegrationOutboxWorker(repository, publisher, {
    workerId: "integration-test-worker", now: () => new Date(current), retryBaseMs: 100, retryMaxMs: 100,
  });
  assert.equal(await worker.runOnce(), 1);
  let stored = await repository.getById(first.eventId);
  assert.equal(stored?.status, "PENDING");
  assert.equal(stored?.attemptCount, 1);
  assert.equal(stored?.responseStatus, 503);
  current = new Date(now.getTime() + 200);
  assert.equal(await worker.runOnce(), 1);
  stored = await repository.getById(first.eventId);
  assert.equal(stored?.status, "DELIVERED");
  assert.equal(stored?.attemptCount, 2);
  assert.equal(stored?.responseStatus, 204);

  const poison = eventFixture("EVENT-POISON", current);
  await repository.enqueue(poison);
  const poisonWorker = new IntegrationOutboxWorker(repository, { publish: async () => { throw new Error("Invalid downstream contract."); } }, {
    workerId: "poison-worker", now: () => new Date(current), maxAttempts: 1,
  });
  assert.equal(await poisonWorker.runOnce(), 1);
  assert.equal((await repository.getById(poison.eventId))?.status, "DEAD_LETTER");
  assert.equal((await repository.redrive(poison.eventId, current))?.status, "PENDING");
});

test("HTTP publisher sends stable idempotency metadata and a verifiable body signature", async () => {
  const event = eventFixture("EVENT-SIGNED", new Date("2026-08-13T12:00:00.000Z"));
  const secret = "integration-test-signing-secret-at-least-32-bytes";
  let captured: { headers: Headers; body: string } | null = null;
  const publisher = new HttpIntegrationEventPublisher({
    endpoint: "http://erp.test/fleet-events",
    signingSecret: secret,
    production: false,
    fetchImplementation: async (_input, init) => {
      captured = { headers: new Headers(init?.headers), body: String(init?.body) };
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(await publisher.publish(event), { status: 204 });
  assert.equal(captured!.headers.get("idempotency-key"), event.idempotencyKey);
  assert.equal(captured!.headers.get("x-brash-event-id"), event.eventId);
  assert.equal(
    captured!.headers.get("x-brash-signature-256"),
    `sha256=${createHmac("sha256", secret).update(captured!.body).digest("hex")}`,
  );
});

function eventFixture(eventId: string, occurredAt: Date): IntegrationEventRecord {
  return {
    eventId,
    idempotencyKey: `idempotency:${eventId}`,
    eventType: "WORK_ORDER_STATUS_CHANGED",
    aggregateType: "WORK_ORDER",
    aggregateId: "WORK-1",
    payload: { workOrderId: "WORK-1", status: "SUCCEEDED" },
    status: "PENDING",
    attemptCount: 0,
    occurredAt: new Date(occurredAt),
    nextAttemptAt: new Date(occurredAt),
    lastAttemptAt: null,
    deliveredAt: null,
    lastError: null,
    responseStatus: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
}
