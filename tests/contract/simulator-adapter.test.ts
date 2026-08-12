import assert from "node:assert/strict";
import test from "node:test";
import { FLEET_SCHEMA_VERSION, type MissionCommand } from "@brash/contracts";
import { SimulatorAdapter } from "@brash/simulator-adapter";
import { ManualClock, robotFixture } from "@brash/test-kit";

test("simulator adapter is idempotent for duplicate command IDs", async () => {
  const clock = new ManualClock();
  const adapter = new SimulatorAdapter([
    robotFixture({ robotId: "BR-01" }),
  ], { now: () => clock.now() });
  await adapter.connect();

  const command: MissionCommand = {
    schemaVersion: FLEET_SCHEMA_VERSION,
    commandId: "COMMAND-0001",
    missionId: "MISSION-0001",
    robotId: "BR-01",
    issuedAt: clock.now().toISOString(),
    expiresAt: new Date(clock.now().getTime() + 30_000).toISOString(),
    mapId: "plant-a@1",
    steps: [],
  };

  const first = await adapter.executeMission(command);
  clock.advance(1_000);
  const duplicate = await adapter.executeMission(command);

  assert.deepEqual(duplicate, first);
  assert.equal(first.status, "ACCEPTED");
  assert.equal((await adapter.getState("BR-01")).activeMissionId, "MISSION-0001");
  await adapter.disconnect();
});

test("simulator adapter emits ordered execution and completion events", async () => {
  const clock = new ManualClock();
  const adapter = new SimulatorAdapter([robotFixture({ robotId: "BR-01" })], { now: () => clock.now() });
  const statuses: string[] = [];
  adapter.subscribe((event) => {
    if (event.type === "MISSION_STATUS") statuses.push(event.status);
  });
  await adapter.connect();

  const command: MissionCommand = {
    schemaVersion: FLEET_SCHEMA_VERSION,
    commandId: "COMMAND-0001",
    missionId: "MISSION-0001",
    robotId: "BR-01",
    issuedAt: clock.now().toISOString(),
    expiresAt: new Date(clock.now().getTime() + 30_000).toISOString(),
    mapId: "plant-a@1",
    steps: [],
  };
  await adapter.executeMission(command);
  clock.advance(1_000);
  await adapter.startMission(command.commandId);
  clock.advance(1_000);
  await adapter.completeMission(command.commandId);

  assert.deepEqual(statuses, ["EXECUTING", "COMPLETED"]);
  assert.equal((await adapter.getState("BR-01")).availability, "AVAILABLE");
  await adapter.disconnect();
});

