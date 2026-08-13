import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("Fleet Core cancels a dispatched mission and releases robot and traffic reservations", async () => {
  const { core } = createTestFleetSystem();
  await core.start();

  const created = await core.createMission(transportMissionFixture());
  const dispatched = await core.dispatchMission(created.missionId);
  assert.equal(dispatched.mission.state, "DISPATCHED");

  const cancelled = await core.cancelMission(created.missionId);
  assert.equal(cancelled.receipt?.status, "ACCEPTED");
  assert.equal(cancelled.mission.state, "CANCELLED");
  assert.equal((await core.getMissionRoute(created.missionId))?.status, "RELEASED");

  const robot = (await core.getSnapshot()).robots.find((entry) => entry.robotId === "BR-01");
  assert.equal(robot?.state.availability, "AVAILABLE");
  assert.equal(robot?.state.activeMissionId, null);
  assert.deepEqual((await core.getMissionEvents(created.missionId)).map((event) => event.type), [
    "MISSION_QUEUED",
    "MISSION_ASSIGNED",
    "ROUTE_RESERVED",
    "COMMAND_DISPATCHED",
    "MISSION_CANCELLATION_REQUESTED",
    "MISSION_CANCELLED",
    "ROUTE_RELEASED",
  ]);

  const duplicate = await core.cancelMission(created.missionId);
  assert.equal(duplicate.mission.state, "CANCELLED");
  assert.equal(duplicate.receipt, null);
  assert.equal((await core.getMissionEvents(created.missionId)).length, 7);
  await core.stop();
});

test("a rejected robot cancellation remains pending and preserves traffic ownership", async () => {
  const { core, adapter, clock } = createTestFleetSystem();
  await core.start();
  const created = await core.createMission(transportMissionFixture());
  const dispatched = await core.dispatchMission(created.missionId);

  adapter.cancelMission = async (robotId, commandId) => ({
    schemaVersion: "1.0",
    commandId,
    missionId: created.missionId,
    robotId,
    status: "REJECTED",
    receivedAt: clock.now().toISOString(),
    reason: "Robot is in a non-interruptible docking phase.",
  });

  const cancellation = await core.cancelMission(created.missionId);
  assert.equal(cancellation.receipt?.status, "REJECTED");
  assert.equal(cancellation.mission.state, "CANCELLING");
  assert.equal((await core.getMissionRoute(created.missionId))?.status, "ACTIVE");

  const robot = (await core.getSnapshot()).robots.find((entry) => entry.robotId === dispatched.mission.assignedRobotId);
  assert.equal(robot?.state.availability, "RESERVED");
  assert.equal((await core.getMissionEvents(created.missionId)).at(-1)?.type, "MISSION_CANCELLATION_REJECTED");
  await core.stop();
});

test("mission completion wins a race with an in-flight cancellation request", async () => {
  const { core, adapter, clock } = createTestFleetSystem();
  await core.start();
  const created = await core.createMission(transportMissionFixture());
  const dispatched = await core.dispatchMission(created.missionId);
  const commandId = dispatched.mission.commandId!;
  await adapter.startMission(commandId);

  adapter.cancelMission = async (robotId, requestedCommandId) => {
    await adapter.completeMission(requestedCommandId);
    return {
      schemaVersion: "1.0",
      commandId: requestedCommandId,
      missionId: created.missionId,
      robotId,
      status: "ACCEPTED",
      receivedAt: clock.now().toISOString(),
    };
  };

  const cancellation = await core.cancelMission(created.missionId);
  assert.equal(cancellation.mission.state, "COMPLETED");
  assert.equal((await core.getMissionRoute(created.missionId))?.status, "RELEASED");
  assert.deepEqual((await core.getMissionEvents(created.missionId)).slice(-3).map((event) => event.type), [
    "MISSION_CANCELLATION_REQUESTED",
    "MISSION_COMPLETED",
    "ROUTE_RELEASED",
  ]);
  await core.stop();
});

test("execution can begin while cancellation confirmation is still pending", async () => {
  const { core, adapter, clock } = createTestFleetSystem();
  await core.start();
  const created = await core.createMission(transportMissionFixture());
  const dispatched = await core.dispatchMission(created.missionId);

  adapter.cancelMission = async (robotId, commandId) => {
    await adapter.startMission(commandId);
    return {
      schemaVersion: "1.0",
      commandId,
      missionId: created.missionId,
      robotId,
      status: "REJECTED",
      receivedAt: clock.now().toISOString(),
      reason: "Cancellation arrived after motion began.",
    };
  };

  const cancellation = await core.cancelMission(created.missionId);
  assert.equal(cancellation.mission.state, "CANCELLING");
  const robot = (await core.getSnapshot()).robots.find((entry) => entry.robotId === dispatched.mission.assignedRobotId);
  assert.equal(robot?.state.availability, "EXECUTING");
  assert.deepEqual((await core.getMissionEvents(created.missionId)).slice(-2).map((event) => event.type), [
    "MISSION_EXECUTING",
    "MISSION_CANCELLATION_REJECTED",
  ]);
  await core.stop();
});
