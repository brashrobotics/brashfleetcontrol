import assert from "node:assert/strict";
import test from "node:test";
import { FLEET_SCHEMA_VERSION, type CommandReceipt, type MissionCommand, type RobotAdapterEvent, type RobotDescriptor, type RobotStateSnapshot } from "@brash/contracts";
import { MappedRobotAdapter, type VendorCommandContext, type VendorProtocolMapper, type VendorRobotDriver } from "@brash/customer-adapter-template";
import { ROBOT_ADAPTER_SDK_VERSION, type Unsubscribe } from "@brash/robot-adapter-sdk";

test("customer adapter template maps a vendor protocol and fences duplicate commands", async () => {
  const driver = new FakeVendorDriver();
  const adapter = new MappedRobotAdapter({
    sdkVersion: ROBOT_ADAPTER_SDK_VERSION,
    adapterId: "acme-rest",
    displayName: "ACME REST adapter",
    adapterVersion: "0.1.0",
    protocol: "REST",
    vendor: "ACME",
    features: ["ROBOT_DISCOVERY", "STATE_POLLING", "STATE_EVENTS", "MISSION_EXECUTION", "MISSION_CANCELLATION", "IDEMPOTENT_COMMANDS"],
    supportedFleetSchemaVersions: [FLEET_SCHEMA_VERSION],
  }, driver, new FakeVendorMapper());
  const events: RobotAdapterEvent[] = [];
  adapter.subscribe((event) => { events.push(event); });
  await adapter.connect();
  try {
    assert.equal((await adapter.listRobots())[0].robotId, "ACME-01");
    assert.equal((await adapter.getState("ACME-01")).batteryPercent, 75);
    const command = commandFixture();
    const first = await adapter.executeMission(command);
    const duplicate = await adapter.executeMission(structuredClone(command));
    assert.deepEqual(duplicate, first);
    assert.equal(driver.executionCalls, 1);
    await assert.rejects(() => adapter.executeMission({ ...command, mapId: "other-map" }), /reused with different content/);
    await driver.emit({ type: "status", status: "EXECUTING" });
    assert.equal(events[0].type, "MISSION_STATUS");
  } finally {
    await adapter.disconnect();
  }
});

class FakeVendorDriver implements VendorRobotDriver {
  executionCalls = 0;
  private handler: ((event: unknown) => void | Promise<void>) | null = null;

  async connect() {}
  async disconnect() {}
  async listRobots() { return [{ serial: "ACME-01" }]; }
  async getState() { return { serial: "ACME-01", battery: 0.75 }; }
  async executeMission(_payload: unknown, context: VendorCommandContext) {
    this.executionCalls += 1;
    return { ...context, accepted: true };
  }
  async cancelMission(_payload: unknown, context: VendorCommandContext) { return { ...context, accepted: true }; }
  subscribe(handler: (event: unknown) => void | Promise<void>): Unsubscribe {
    this.handler = handler;
    return () => { this.handler = null; };
  }
  async emit(event: unknown) { await this.handler?.(event); }
}

class FakeVendorMapper implements VendorProtocolMapper {
  toDescriptor(payload: unknown): RobotDescriptor {
    const serial = (payload as { serial: string }).serial;
    return { robotId: serial, displayName: serial, vendor: "ACME", model: "X1", capabilities: { actions: ["pallet_transport"], maxPayloadKg: 500, allowedZones: [] } };
  }
  toState(payload: unknown): RobotStateSnapshot {
    const value = payload as { serial: string; battery: number };
    return { schemaVersion: FLEET_SCHEMA_VERSION, robotId: value.serial, sequence: 1, observedAt: "2026-08-12T10:00:00.000Z", lastSeenAt: "2026-08-12T10:00:00.000Z", connectionChangedAt: "2026-08-12T10:00:00.000Z", connection: "ONLINE", availability: "AVAILABLE", batteryPercent: value.battery * 100, pose: { mapId: "plant-a@1", x: 0, y: 0, yaw: 0 }, activeMissionId: null };
  }
  fromMissionCommand(command: MissionCommand) { return { orderId: command.commandId }; }
  fromCancellation(_robotId: string, commandId: string) { return { cancelOrderId: commandId }; }
  toCommandReceipt(payload: unknown, expected: VendorCommandContext): CommandReceipt {
    return { schemaVersion: FLEET_SCHEMA_VERSION, commandId: expected.commandId, missionId: expected.missionId, robotId: expected.robotId, status: (payload as { accepted: boolean }).accepted ? "ACCEPTED" : "REJECTED", receivedAt: "2026-08-12T10:00:00.000Z" };
  }
  toAdapterEvent(payload: unknown): RobotAdapterEvent | null {
    const value = payload as { type: string; status: "EXECUTING" };
    return value.type === "status" ? { type: "MISSION_STATUS", robotId: "ACME-01", missionId: "MISSION-1", commandId: "COMMAND-1", status: value.status, observedAt: "2026-08-12T10:00:01.000Z" } : null;
  }
}

function commandFixture(): MissionCommand {
  return { schemaVersion: FLEET_SCHEMA_VERSION, commandId: "COMMAND-1", missionId: "MISSION-1", robotId: "ACME-01", issuedAt: "2026-08-12T10:00:00.000Z", expiresAt: "2026-08-12T10:01:00.000Z", mapId: "plant-a@1", steps: [] };
}
