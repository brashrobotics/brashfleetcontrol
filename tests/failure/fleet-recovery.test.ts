import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, robotFixture, transportMissionFixture } from "@brash/test-kit";

test("offline robot puts its mission and route into a safety hold", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture());
    const dispatch = await system.core.dispatchMission(mission.missionId);
    assert.equal(dispatch.mission.state, "DISPATCHED");

    system.clock.advance(30_001);
    await system.core.processFleetRecovery();

    const recovered = await system.core.getMission(mission.missionId);
    const route = await system.core.getMissionRoute(mission.missionId);
    const robot = await system.robots.getById(dispatch.decision.selectedRobotId!);
    assert.equal(robot?.connection, "OFFLINE");
    assert.equal(recovered.state, "RECOVERY_REQUIRED");
    assert.equal(route?.status, "SAFETY_HOLD");
    assert.ok(route?.leaseExpiresAt);

    const events = await system.core.getMissionEvents(mission.missionId);
    assert.ok(events.some((event) => event.type === "ROBOT_OFFLINE"));
    assert.ok(events.some((event) => event.type === "TRAFFIC_SAFETY_HOLD"));
  } finally {
    await system.core.stop();
  }
});

test("reconnected robot resumes the mission while the conservative traffic hold remains", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture());
    const dispatch = await system.core.dispatchMission(mission.missionId);
    system.clock.advance(30_001);
    await system.core.processFleetRecovery();

    await system.adapter.publishRobotState(dispatch.decision.selectedRobotId!, {
      connection: "ONLINE",
      availability: "RESERVED",
      activeMissionId: mission.missionId,
    });

    assert.equal((await system.core.getMission(mission.missionId)).state, "DISPATCHED");
    assert.equal((await system.core.getMissionRoute(mission.missionId))?.status, "SAFETY_HOLD");
    const events = await system.core.getMissionEvents(mission.missionId);
    assert.ok(events.some((event) => event.type === "MISSION_RECOVERED"));
  } finally {
    await system.core.stop();
  }
});

test("a robot that confirms the old command is clear causes safe reassignment", async () => {
  const robots = [
    robotFixture({ robotId: "BR-A", x: 10, y: 5, capabilities: ["pallet_transport"] }),
    robotFixture({ robotId: "BR-B", x: 70, y: 65, capabilities: ["pallet_transport"] }),
  ];
  const system = createTestFleetSystem({ robots });
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture());
    const first = await system.core.dispatchMission(mission.missionId);
    assert.equal(first.decision.selectedRobotId, "BR-A");
    system.clock.advance(30_001);
    await system.adapter.publishRobotState("BR-B", {
      connection: "ONLINE",
      availability: "AVAILABLE",
      activeMissionId: null,
    });
    await system.core.processFleetRecovery();

    await system.adapter.publishRobotState("BR-A", {
      connection: "ONLINE",
      availability: "AVAILABLE",
      activeMissionId: null,
    });

    const reassigned = await system.core.getMission(mission.missionId);
    assert.equal(reassigned.state, "DISPATCHED");
    assert.equal(reassigned.assignedRobotId, "BR-B");
    assert.equal((await system.robots.getById("BR-A"))?.availability, "ERROR");
    assert.equal((await system.core.getMissionRoute(mission.missionId))?.status, "ACTIVE");
    const events = await system.core.getMissionEvents(mission.missionId);
    assert.ok(events.some((event) => event.type === "MISSION_RECOVERY_REQUEUED"));
  } finally {
    await system.core.stop();
  }
});

test("fresh telemetry renews a route lease before it expires", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture());
    const dispatch = await system.core.dispatchMission(mission.missionId);
    const initial = await system.core.getMissionRoute(mission.missionId);
    system.clock.advance(26_000);
    await system.adapter.publishRobotState(dispatch.decision.selectedRobotId!, {
      connection: "ONLINE",
      availability: "RESERVED",
      activeMissionId: mission.missionId,
    });
    await system.core.processFleetRecovery();
    const renewed = await system.core.getMissionRoute(mission.missionId);
    assert.ok(new Date(renewed!.leaseExpiresAt).getTime() > new Date(initial!.leaseExpiresAt).getTime());
  } finally {
    await system.core.stop();
  }
});
