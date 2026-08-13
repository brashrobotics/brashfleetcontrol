import assert from "node:assert/strict";
import test from "node:test";
import { FLEET_SCHEMA_VERSION, type CommandReceipt, type MissionCommand } from "@brash/contracts";
import {
  CompositeRobotAdapter,
  assertAdapterConformance,
  issueAdapterCertificate,
  mapVendorCapabilities,
  runAdapterConformance,
  verifyAdapterCertificate,
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
  assert.equal(report.checks.length, 9);
  assert.ok(report.checks.every((check) => check.status === "PASS"));
  assert.equal(report.certificationVersion, "1.0");
  assert.deepEqual(report.checks.map((check) => check.code), [
    "MANIFEST_COMPATIBILITY", "CONNECTION_INVENTORY", "COMMAND_IDEMPOTENCY", "COMMAND_ID_COLLISION_FENCING", "RECEIPT_LOSS_RECOVERY",
    "CANCELLATION_AND_EVENTS", "RECONNECT_RECONCILIATION", "STATE_SEQUENCE_MONOTONICITY", "OPERATION_DEADLINES",
  ]);
  const key = "adapter-certification-test-key-32-bytes-minimum";
  const issuedAt = new Date("2026-08-13T10:00:00.000Z");
  const certificate = issueAdapterCertificate(report, "qa-approver", key, { issuedAt, validityDays: 90 });
  assert.deepEqual(verifyAdapterCertificate(certificate, key, issuedAt), { valid: true, reason: null });
  const tampered = structuredClone(certificate);
  tampered.adapterVersion = "tampered";
  assert.equal(verifyAdapterCertificate(tampered, key, issuedAt).valid, false);
  assert.equal(verifyAdapterCertificate(certificate, key, new Date("2027-01-01T00:00:00.000Z")).reason, "Certificate has expired.");
});

test("certification identifies an adapter that ignores command ID collisions", async () => {
  class CollisionBlindSimulator extends SimulatorAdapter {
    private readonly cached = new Map<string, CommandReceipt>();

    override async executeMission(command: MissionCommand): Promise<CommandReceipt> {
      const duplicate = this.cached.get(command.commandId);
      if (duplicate) return structuredClone(duplicate);
      const receipt = await super.executeMission(command);
      this.cached.set(command.commandId, structuredClone(receipt));
      return receipt;
    }
  }

  const report = await runAdapterConformance({
    createAdapter: () => new CollisionBlindSimulator([robotFixture({ robotId: "NONCOMPLIANT-01" })]),
  });
  assert.equal(report.compliant, false);
  assert.equal(report.checks.find((check) => check.code === "COMMAND_ID_COLLISION_FENCING")?.status, "FAIL");
  assert.throws(
    () => issueAdapterCertificate(report, "qa-approver", "adapter-certification-test-key-32-bytes-minimum"),
    /fully compliant/,
  );
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
