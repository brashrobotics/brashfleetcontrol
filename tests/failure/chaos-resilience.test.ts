import assert from "node:assert/strict";
import test from "node:test";
import type { AuditRepository, WorkflowStepRecord } from "@brash/application";
import { InMemoryAuditRepository, InMemoryWorkflowRepository } from "@brash/persistence";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";
import { FleetApi } from "../../apps/fleet-server/src/api/fleet-api.js";
import { SecuredFleetApi } from "../../apps/fleet-server/src/api/secured-fleet-api.js";
import { StaticTokenIdentityProvider } from "../../apps/fleet-server/src/modules/identity/access-control.js";

test("a duplicate and out-of-order telemetry storm cannot regress robot state", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const stale = await system.adapter.getState("BR-01");
    await system.adapter.publishRobotState("BR-01", { batteryPercent: 55 });
    const current = await system.adapter.getState("BR-01");
    const corrupted = { ...stale, observedAt: system.clock.advance(10_000).toISOString(), batteryPercent: 1, availability: "ERROR" as const };
    await Promise.all(Array.from({ length: 100 }, () => system.core.handleAdapterEvent({ type: "ROBOT_STATE", state: corrupted })));
    await Promise.all(Array.from({ length: 100 }, () => system.core.handleAdapterEvent({ type: "ROBOT_STATE", state: current })));
    const robot = (await system.core.getSnapshot()).robots.find((candidate) => candidate.robotId === "BR-01")!;
    assert.equal(robot.state.sequence, current.sequence);
    assert.equal(robot.state.batteryPercent, 55);
    assert.equal(robot.state.availability, "AVAILABLE");
  } finally {
    await system.core.stop();
  }
});

test("an expired workflow worker lease is safely taken over by another instance", async () => {
  const repository = new InMemoryWorkflowRepository();
  const now = new Date("2026-08-13T10:00:00.000Z");
  const step: WorkflowStepRecord = {
    workflowId: "WF-LEASE-CHAOS",
    definition: { stepId: "wait", name: "Wait", type: "WAIT", dependsOn: [], timeoutSeconds: 60, maxAttempts: 1, retryDelaySeconds: 1, durationSeconds: 1 },
    status: "PENDING",
    attemptCount: 0,
    missionId: null,
    resourceReservationId: null,
    startedAt: null,
    completedAt: null,
    nextAttemptAt: now,
    timeoutAt: null,
    waitUntil: null,
    lastError: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
  await repository.create({
    workflowId: step.workflowId,
    name: "Lease chaos",
    externalReference: null,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    failureReason: null,
  }, [step]);
  assert.equal((await repository.claimRunnable(1, { workerId: "worker-a", claimedAt: now, leaseDurationMs: 1_000 })).length, 1);
  assert.equal((await repository.claimRunnable(1, { workerId: "worker-b", claimedAt: new Date(now.getTime() + 999), leaseDurationMs: 1_000 })).length, 0);
  const takeover = await repository.claimRunnable(1, { workerId: "worker-b", claimedAt: new Date(now.getTime() + 1_001), leaseDurationMs: 1_000 });
  assert.equal(takeover.length, 1);
  assert.equal(takeover[0].leaseOwner, "worker-b");
});

test("an audit storage outage fails a mutation closed before domain state changes", async () => {
  const { core } = createTestFleetSystem();
  const unavailableAudit: AuditRepository = {
    append: async () => { throw new Error("Injected audit database outage."); },
    list: (filter) => new InMemoryAuditRepository().list(filter),
  };
  const api = new SecuredFleetApi(new FleetApi(core), {
    identities: new StaticTokenIdentityProvider([{ token: "chaos-operator-token", subjectId: "chaos-operator", displayName: "Chaos Operator", subjectType: "USER", role: "OPERATOR", siteIds: ["*"] }]),
    audit: unavailableAudit,
  });
  await core.start();
  try {
    const response = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
      method: "POST",
      headers: { authorization: "Bearer chaos-operator-token", "content-type": "application/json" },
      body: JSON.stringify(transportMissionFixture({ externalReference: "CHAOS-AUDIT-OUTAGE" })),
    }));
    assert.equal(response.status, 503);
    assert.equal((await core.getSnapshot()).missions.length, 0);
  } finally {
    await core.stop();
  }
});
