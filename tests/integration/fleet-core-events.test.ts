import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("Fleet Core reconciles simulator execution events into mission and robot state", async () => {
  const { core, adapter, clock } = createTestFleetSystem();
  await core.start();

  const created = await core.createMission(transportMissionFixture());
  const dispatched = await core.dispatchMission(created.missionId);
  assert.equal(dispatched.decision.selectedRobotId, "BR-01");
  assert.equal(dispatched.receipt?.status, "ACCEPTED");
  assert.equal(dispatched.mission.state, "DISPATCHED");

  clock.advance(1_000);
  await adapter.startMission(dispatched.mission.commandId!);
  assert.equal((await core.getMission(created.missionId)).state, "EXECUTING");

  clock.advance(2_000);
  await adapter.completeMission(dispatched.mission.commandId!);
  assert.equal((await core.getMission(created.missionId)).state, "COMPLETED");

  const events = await core.getMissionEvents(created.missionId);
  assert.deepEqual(events.map((event) => event.type), [
    "MISSION_QUEUED",
    "MISSION_ASSIGNED",
    "ROUTE_RESERVED",
    "COMMAND_DISPATCHED",
    "MISSION_EXECUTING",
    "MISSION_COMPLETED",
    "ROUTE_RELEASED",
  ]);
  assert.equal(events.at(-1)?.state, "COMPLETED");
  assert.equal(events.at(-1)?.commandId, dispatched.mission.commandId);

  const selectedRobot = (await core.getSnapshot()).robots.find((robot) => robot.robotId === "BR-01");
  assert.equal(selectedRobot?.state.availability, "AVAILABLE");
  assert.equal(selectedRobot?.state.activeMissionId, null);
  await core.stop();
});

test("external mission reference makes mission creation idempotent", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const request = transportMissionFixture({ externalReference: "WMS-IDEMPOTENT-1" });

  const first = await core.createMission(request);
  const duplicate = await core.createMission(request);

  assert.equal(duplicate.missionId, first.missionId);
  assert.equal((await core.getSnapshot()).missions.length, 1);
  await core.stop();
});
