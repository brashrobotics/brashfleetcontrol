import assert from "node:assert/strict";
import test from "node:test";
import { DomainError, Mission } from "@brash/domain";

function createMission() {
  return Mission.create({
    missionId: "MISSION-0001",
    externalReference: "WMS-1001",
    priority: 70,
    requiredCapabilities: ["pallet_transport"],
    payloadKg: 300,
    pickup: { stationId: "A", mapId: "plant-a@1", x: 10, y: 5 },
    dropoff: { stationId: "B", mapId: "plant-a@1", x: 70, y: 25 },
    createdAt: new Date("2026-08-12T10:00:00.000Z"),
  });
}

test("mission enforces the happy-path lifecycle", () => {
  const mission = createMission();
  const at = new Date("2026-08-12T10:00:01.000Z");

  mission.queue(at);
  mission.assign("BR-01", at);
  mission.markDispatched("COMMAND-0001", at);
  mission.markExecuting("COMMAND-0001", at);
  mission.complete("COMMAND-0001", at);

  assert.equal(mission.state, "COMPLETED");
  assert.equal(mission.assignedRobotId, "BR-01");
  assert.equal(mission.commandId, "COMMAND-0001");
});

test("mission rejects invalid and mismatched transitions", () => {
  const mission = createMission();
  const at = new Date("2026-08-12T10:00:01.000Z");

  assert.throws(() => mission.assign("BR-01", at), (error: unknown) =>
    error instanceof DomainError && error.code === "MISSION_TRANSITION_INVALID",
  );

  mission.queue(at);
  mission.assign("BR-01", at);
  mission.markDispatched("COMMAND-0001", at);

  assert.throws(() => mission.markExecuting("COMMAND-OTHER", at), (error: unknown) =>
    error instanceof DomainError && error.code === "MISSION_COMMAND_MISMATCH",
  );
});

test("a rejected assignment returns a mission to the queue", () => {
  const mission = createMission();
  const at = new Date("2026-08-12T10:00:01.000Z");
  mission.queue(at);
  mission.assign("BR-01", at);
  mission.releaseRejectedAssignment("Robot rejected the job.", at);

  assert.equal(mission.state, "QUEUED");
  assert.equal(mission.assignedRobotId, null);
  assert.equal(mission.failureReason, "Robot rejected the job.");
});

test("a queued mission can be cancelled without a robot command", () => {
  const mission = createMission();
  const queuedAt = new Date("2026-08-12T10:00:01.000Z");
  const cancelledAt = new Date("2026-08-12T10:00:02.000Z");
  mission.queue(queuedAt);
  mission.cancelQueued(cancelledAt);

  assert.equal(mission.state, "CANCELLED");
  assert.equal(mission.assignedRobotId, null);
  assert.equal(mission.commandId, null);
  assert.deepEqual(mission.updatedAt, cancelledAt);
});

test("an executing mission requires cancellation confirmation from its command", () => {
  const mission = createMission();
  const at = new Date("2026-08-12T10:00:01.000Z");
  mission.queue(at);
  mission.assign("BR-01", at);
  mission.markDispatched("COMMAND-0001", at);
  mission.markExecuting("COMMAND-0001", at);
  mission.requestCancellation(at);

  assert.equal(mission.state, "CANCELLING");
  assert.throws(() => mission.cancel("COMMAND-OTHER", at), (error: unknown) =>
    error instanceof DomainError && error.code === "MISSION_COMMAND_MISMATCH",
  );
  mission.cancel("COMMAND-0001", at);
  assert.equal(mission.state, "CANCELLED");
});

test("mission can pause for recovery and resume its previous state", () => {
  const mission = createMission();
  mission.queue(new Date("2026-08-12T10:00:01.000Z"));
  mission.assign("BR-01", new Date("2026-08-12T10:00:02.000Z"));
  mission.markDispatched("COMMAND-0001", new Date("2026-08-12T10:00:03.000Z"));
  mission.requireRecovery("Heartbeat expired.", new Date("2026-08-12T10:00:33.000Z"));
  assert.equal(mission.state, "RECOVERY_REQUIRED");
  assert.equal(mission.recoveryPreviousState, "DISPATCHED");
  mission.resumeRecovery(new Date("2026-08-12T10:00:34.000Z"));
  assert.equal(mission.state, "DISPATCHED");
  assert.equal(mission.recoveryPreviousState, null);
});

test("a cleared recovered mission is fenced and requeued", () => {
  const mission = createMission();
  mission.queue(new Date("2026-08-12T10:00:01.000Z"));
  mission.assign("BR-01", new Date("2026-08-12T10:00:02.000Z"));
  mission.requireRecovery("Robot is offline.", new Date("2026-08-12T10:00:32.000Z"));
  mission.requeueAfterRecovery("Robot confirmed the old command is inactive.", new Date("2026-08-12T10:00:40.000Z"));
  assert.equal(mission.state, "QUEUED");
  assert.equal(mission.assignedRobotId, null);
  assert.equal(mission.commandId, null);
});
