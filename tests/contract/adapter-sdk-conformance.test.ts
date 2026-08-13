import assert from "node:assert/strict";
import test from "node:test";
import { FLEET_SCHEMA_VERSION, type MissionCommand } from "@brash/contracts";
import {
  CompositeRobotAdapter,
  assertAdapterConformance,
  mapVendorCapabilities,
} from "@brash/robot-adapter-sdk";
import { SimulatorAdapter } from "@brash/simulator-adapter";
import { ManualClock, robotFixture } from "@brash/test-kit";

test("simulator passes the shared Robot Adapter SDK conformance suite", async () => {
  const report = await assertAdapterConformance({
    createAdapter: () => {
      const clock = new ManualClock();
      return new SimulatorAdapter([robotFixture({ robotId: "SDK-ROBOT-01" })], { now: () => clock.now() });
    },
  });
  assert.equal(report.compliant, true);
  assert.equal(report.checks.length, 4);
  assert.ok(report.checks.every((check) => check.status === "PASS"));
});

test("composite adapter discovers and routes commands across vendor adapters", async () => {
  const clock = new ManualClock();
  const north = new SimulatorAdapter([robotFixture({ robotId: "NORTH-01" })], {
    adapterId: "vendor-north", now: () => clock.now(),
  });
  const south = new SimulatorAdapter([robotFixture({ robotId: "SOUTH-01" })], {
    adapterId: "vendor-south", now: () => clock.now(),
  });
  const composite = new CompositeRobotAdapter([north, south]);
  const statuses: string[] = [];
  composite.subscribe((event) => {
    if (event.type === "MISSION_STATUS") statuses.push(`${event.robotId}:${event.status}`);
  });
  await composite.connect();
  try {
    assert.deepEqual((await composite.listRobots()).map((robot) => robot.robotId), ["NORTH-01", "SOUTH-01"]);
    const command: MissionCommand = {
      schemaVersion: FLEET_SCHEMA_VERSION,
      commandId: "COMPOSITE-COMMAND-1",
      missionId: "COMPOSITE-MISSION-1",
      robotId: "SOUTH-01",
      issuedAt: clock.now().toISOString(),
      expiresAt: new Date(clock.now().getTime() + 30_000).toISOString(),
      mapId: "plant-a@1",
      steps: [],
    };
    assert.equal((await composite.executeMission(command)).robotId, "SOUTH-01");
    await south.startMission(command.commandId);
    assert.deepEqual(statuses, ["SOUTH-01:EXECUTING"]);
    assert.equal((await north.getState("NORTH-01")).availability, "AVAILABLE");
  } finally {
    await composite.disconnect();
  }
});

test("composite adapter rejects duplicate robot ownership", async () => {
  const first = new SimulatorAdapter([robotFixture({ robotId: "DUPLICATE-01" })], { adapterId: "vendor-a" });
  const second = new SimulatorAdapter([robotFixture({ robotId: "DUPLICATE-01" })], { adapterId: "vendor-b" });
  const composite = new CompositeRobotAdapter([first, second]);
  await assert.rejects(() => composite.connect(), /declared by both vendor-a and vendor-b/);
});

test("vendor capabilities map to normalized canonical constraints", () => {
  const capabilities = mapVendorCapabilities(
    ["Pallet Move", "Inventory-Camera", "Unknown"],
    [
      { vendorAction: "pallet move", canonicalAction: "pallet_transport" },
      { vendorAction: "inventory camera", canonicalAction: "inventory_scan" },
    ],
    { maxPayloadKg: 750, allowedZones: ["Raw Material", "raw-material", "Production"] },
  );
  assert.deepEqual(capabilities, {
    actions: ["inventory_scan", "pallet_transport"],
    maxPayloadKg: 750,
    allowedZones: ["production", "raw_material"],
  });
});

