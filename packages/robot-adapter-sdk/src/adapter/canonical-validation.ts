import {
  FLEET_SCHEMA_VERSION,
  type CommandReceipt,
  type RobotAdapterEvent,
  type RobotDescriptor,
  type RobotStateSnapshot,
} from "@brash/contracts";

export class AdapterContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AdapterContractError";
  }
}

export function assertRobotDescriptor(value: RobotDescriptor): void {
  nonEmpty(value.robotId, "robotId");
  nonEmpty(value.displayName, "displayName");
  nonEmpty(value.vendor, "vendor");
  nonEmpty(value.model, "model");
  if (value.capabilities.actions.length === 0) fail("DESCRIPTOR_ACTIONS_EMPTY", `${value.robotId} must declare at least one action capability.`);
  if (new Set(value.capabilities.actions).size !== value.capabilities.actions.length) fail("DESCRIPTOR_ACTIONS_DUPLICATE", `${value.robotId} has duplicate action capabilities.`);
  if (!Number.isFinite(value.capabilities.maxPayloadKg) || value.capabilities.maxPayloadKg < 0) fail("DESCRIPTOR_PAYLOAD_INVALID", `${value.robotId} maxPayloadKg must be non-negative.`);
}

export function assertRobotState(value: RobotStateSnapshot, expectedRobotId?: string): void {
  if (value.schemaVersion !== FLEET_SCHEMA_VERSION) fail("STATE_SCHEMA_UNSUPPORTED", `${value.robotId} uses unsupported state schema ${value.schemaVersion}.`);
  nonEmpty(value.robotId, "robotId");
  if (expectedRobotId && value.robotId !== expectedRobotId) fail("STATE_ROBOT_MISMATCH", `Expected state for ${expectedRobotId}, received ${value.robotId}.`);
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) fail("STATE_SEQUENCE_INVALID", `${value.robotId} sequence must be a non-negative safe integer.`);
  timestamp(value.observedAt, "observedAt");
  timestamp(value.lastSeenAt, "lastSeenAt");
  timestamp(value.connectionChangedAt, "connectionChangedAt");
  if (!Number.isFinite(value.batteryPercent) || value.batteryPercent < 0 || value.batteryPercent > 100) fail("STATE_BATTERY_INVALID", `${value.robotId} batteryPercent must be between 0 and 100.`);
  nonEmpty(value.pose.mapId, "pose.mapId");
  for (const [field, number] of [["pose.x", value.pose.x], ["pose.y", value.pose.y], ["pose.yaw", value.pose.yaw]] as const) {
    if (!Number.isFinite(number)) fail("STATE_POSE_INVALID", `${value.robotId} ${field} must be finite.`);
  }
}

export function assertAdapterInventory(descriptors: RobotDescriptor[], states: RobotStateSnapshot[]): void {
  const robotIds = new Set<string>();
  for (const descriptor of descriptors) {
    assertRobotDescriptor(descriptor);
    if (robotIds.has(descriptor.robotId)) fail("INVENTORY_ROBOT_DUPLICATE", `Robot ${descriptor.robotId} is declared more than once.`);
    robotIds.add(descriptor.robotId);
  }
  if (states.length !== descriptors.length) fail("INVENTORY_STATE_MISSING", "Every robot descriptor must have exactly one state snapshot.");
  const stateRobotIds = new Set<string>();
  for (const state of states) {
    assertRobotState(state, state.robotId);
    if (!robotIds.has(state.robotId)) fail("INVENTORY_STATE_ORPHAN", `State for undeclared robot ${state.robotId} was returned.`);
    if (stateRobotIds.has(state.robotId)) fail("INVENTORY_STATE_DUPLICATE", `State for robot ${state.robotId} was returned more than once.`);
    stateRobotIds.add(state.robotId);
  }
  for (const robotId of robotIds) {
    if (!stateRobotIds.has(robotId)) fail("INVENTORY_STATE_MISSING", `State for robot ${robotId} is missing.`);
  }
}

export function assertCommandReceipt(
  receipt: CommandReceipt,
  expected: { commandId: string; missionId: string; robotId: string },
): void {
  if (receipt.schemaVersion !== FLEET_SCHEMA_VERSION) fail("RECEIPT_SCHEMA_UNSUPPORTED", `Receipt uses unsupported schema ${receipt.schemaVersion}.`);
  if (receipt.commandId !== expected.commandId || receipt.missionId !== expected.missionId || receipt.robotId !== expected.robotId) {
    fail("RECEIPT_CORRELATION_INVALID", "Receipt command, mission, and robot identifiers must match the request.");
  }
  timestamp(receipt.receivedAt, "receivedAt");
  if (receipt.status === "REJECTED" && !receipt.reason?.trim()) fail("RECEIPT_REJECTION_REASON_MISSING", "Rejected receipts must explain the reason.");
}

export function assertAdapterEvent(event: RobotAdapterEvent): void {
  if (event.type === "ROBOT_STATE") return assertRobotState(event.state);
  nonEmpty(event.robotId, "event.robotId");
  nonEmpty(event.missionId, "event.missionId");
  nonEmpty(event.commandId, "event.commandId");
  timestamp(event.observedAt, "event.observedAt");
  if (event.status === "FAILED" && !event.reason?.trim()) fail("EVENT_FAILURE_REASON_MISSING", "Failed mission events must explain the reason.");
}

function nonEmpty(value: string, field: string): void {
  if (!value?.trim()) fail("CANONICAL_FIELD_EMPTY", `${field} must not be empty.`);
}

function timestamp(value: string, field: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) fail("CANONICAL_TIMESTAMP_INVALID", `${field} must be an ISO-8601 timestamp.`);
}

function fail(code: string, message: string): never {
  throw new AdapterContractError(code, message);
}
