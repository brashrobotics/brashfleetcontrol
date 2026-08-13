import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, robotFixture, transportMissionFixture } from "@brash/test-kit";

test("operator quarantine fences dispatch and survives newer AVAILABLE telemetry", async () => {
  const system = createTestFleetSystem({ robots: [
    robotFixture({ robotId: "BR-QUARANTINE", x: 10, y: 5 }),
    robotFixture({ robotId: "BR-BACKUP", x: 60, y: 60 }),
  ] });
  await system.core.start();
  try {
    const quarantined = await system.core.quarantineRobot("BR-QUARANTINE", { reason: "Steering inspection required", operatorId: "operator-1" });
    assert.equal(quarantined.state.availability, "ERROR");
    assert.equal(quarantined.operatorControl?.status, "QUARANTINED");

    await system.adapter.publishRobotState("BR-QUARANTINE", { availability: "AVAILABLE", activeMissionId: null });
    const afterTelemetry = (await system.core.getSnapshot()).robots.find((robot) => robot.robotId === "BR-QUARANTINE")!;
    assert.equal(afterTelemetry.state.availability, "ERROR");
    assert.equal(afterTelemetry.operatorControl?.reason, "Steering inspection required");

    const mission = await system.core.createMission(transportMissionFixture({ externalReference: "QUARANTINE-DISPATCH" }));
    const dispatch = await system.core.dispatchMission(mission.missionId);
    assert.equal(dispatch.decision.selectedRobotId, "BR-BACKUP");
    assert.ok(!dispatch.decision.candidates.some((candidate) => candidate.robotId === "BR-QUARANTINE"));

    await system.adapter.publishRobotState("BR-QUARANTINE", { availability: "AVAILABLE", activeMissionId: null });
    const released = await system.core.releaseRobotQuarantine("BR-QUARANTINE", { inspectionReference: "INSPECTION-2026-0813", operatorId: "operator-2" });
    assert.equal(released.operatorControl?.status, "CLEARED");
    assert.equal(released.state.availability, "AVAILABLE");
  } finally {
    await system.core.stop();
  }
});

test("active mission quarantine creates a safety hold and controlled reassignment targets the nominated robot", async () => {
  const system = createTestFleetSystem({ robots: [
    robotFixture({ robotId: "BR-OLD", x: 10, y: 5 }),
    robotFixture({ robotId: "BR-NEAR", x: 12, y: 5 }),
    robotFixture({ robotId: "BR-TARGET", x: 70, y: 70 }),
  ] });
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture({ externalReference: "OPERATOR-RECOVERY", preferredRobotId: "BR-OLD" }));
    const original = await system.core.dispatchMission(mission.missionId);
    assert.equal(original.decision.selectedRobotId, "BR-OLD");

    await system.core.quarantineRobot("BR-OLD", { reason: "Unexpected localization jump", operatorId: "operator-1" });
    assert.equal((await system.core.getMission(mission.missionId)).state, "RECOVERY_REQUIRED");
    assert.equal((await system.core.getMissionRoute(mission.missionId))?.status, "SAFETY_HOLD");
    await assert.rejects(
      system.core.reassignRecoveryMission(mission.missionId, { commandCleared: false, clearanceEvidence: "", operatorId: "operator-1" }),
      /clearance evidence/i,
    );

    const reassigned = await system.core.reassignRecoveryMission(mission.missionId, {
      commandCleared: true,
      clearanceEvidence: "PLC gateway confirmed command queue empty; ticket SAFETY-42",
      targetRobotId: "BR-TARGET",
      operatorId: "operator-2",
    });
    assert.equal(reassigned.decision.selectedRobotId, "BR-TARGET");
    assert.equal(reassigned.mission.state, "DISPATCHED");
    assert.equal((await system.robots.getOperatorControl("BR-OLD"))?.status, "QUARANTINED");
    assert.equal((await system.core.getMissionRoute(mission.missionId))?.robotId, "BR-TARGET");
    const events = await system.core.getMissionEvents(mission.missionId);
    assert.ok(events.some((event) => event.type === "ROBOT_OPERATOR_QUARANTINED"));
    assert.ok(events.some((event) => event.type === "MISSION_OPERATOR_REASSIGNED" && event.data.targetRobotId === "BR-TARGET"));
  } finally {
    await system.core.stop();
  }
});
