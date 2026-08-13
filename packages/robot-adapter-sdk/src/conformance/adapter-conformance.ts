import { FLEET_SCHEMA_VERSION, type MissionCommand, type RobotAdapterEvent, type RobotDescriptor, type RobotStateSnapshot } from "@brash/contracts";
import { assertAdapterInventory, assertAdapterEvent, assertCommandReceipt } from "../adapter/canonical-validation.js";
import { assertAdapterManifest } from "../adapter/adapter-manifest.js";
import type { RobotAdapter } from "../adapter/robot-adapter.js";
import { FaultInjectingAdapter } from "../testing/fault-injecting-adapter.js";

export interface AdapterConformanceOptions {
  createAdapter: () => RobotAdapter | Promise<RobotAdapter>;
  createCommand?: (descriptor: RobotDescriptor, state: RobotStateSnapshot, checkName: string) => MissionCommand;
  eventDeliveryTimeoutMs?: number;
  operationTimeoutMs?: number;
}

export interface AdapterConformanceCheck {
  code: AdapterCertificationCode;
  category: "CONTRACT" | "LIFECYCLE" | "COMMAND" | "RECOVERY" | "EVENT" | "PERFORMANCE";
  name: string;
  status: "PASS" | "FAIL";
  durationMs: number;
  error: string | null;
}

export type AdapterCertificationCode =
  | "MANIFEST_COMPATIBILITY"
  | "CONNECTION_INVENTORY"
  | "COMMAND_IDEMPOTENCY"
  | "COMMAND_ID_COLLISION_FENCING"
  | "RECEIPT_LOSS_RECOVERY"
  | "CANCELLATION_AND_EVENTS"
  | "RECONNECT_RECONCILIATION"
  | "STATE_SEQUENCE_MONOTONICITY"
  | "OPERATION_DEADLINES";

export interface AdapterConformanceReport {
  adapterId: string;
  sdkVersion: string;
  compliant: boolean;
  checkedAt: string;
  certificationVersion: "1.0";
  adapterVersion: string;
  protocol: string;
  checks: AdapterConformanceCheck[];
}

export class AdapterConformanceError extends Error {
  constructor(readonly report: AdapterConformanceReport) {
    super(`Adapter ${report.adapterId} failed: ${report.checks.filter((check) => check.status === "FAIL").map((check) => check.name).join(", ")}.`);
    this.name = "AdapterConformanceError";
  }
}

export async function runAdapterConformance(options: AdapterConformanceOptions): Promise<AdapterConformanceReport> {
  const probe = await options.createAdapter();
  const adapterId = probe.adapterId;
  const sdkVersion = probe.manifest.sdkVersion;
  const checks: AdapterConformanceCheck[] = [];
  const operationTimeoutMs = options.operationTimeoutMs ?? 2_000;

  await runCheck(checks, "MANIFEST_COMPATIBILITY", "CONTRACT", "manifest and Fleet schema compatibility", async () => {
    assertAdapterManifest(probe.manifest);
    if (probe.adapterId !== probe.manifest.adapterId) throw new Error("adapterId must match manifest.adapterId.");
    if (!probe.manifest.supportedFleetSchemaVersions.includes(FLEET_SCHEMA_VERSION)) throw new Error(`Adapter does not support Fleet schema ${FLEET_SCHEMA_VERSION}.`);
  });

  await runCheck(checks, "CONNECTION_INVENTORY", "LIFECYCLE", "connection lifecycle and canonical inventory", async () => {
    const adapter = await options.createAdapter();
    await expectRejected(() => adapter.listRobots(), "listRobots must reject before connect.");
    await adapter.connect();
    try {
      const { descriptors, states } = await readAvailableInventory(adapter);
      assertAdapterInventory(descriptors, states);
    } finally {
      await adapter.disconnect();
    }
    await expectRejected(() => adapter.getState("conformance-disconnected-probe"), "getState must reject after disconnect.");
  });

  await runCheck(checks, "COMMAND_IDEMPOTENCY", "COMMAND", "idempotent mission receipt", async () => {
    const adapter = await options.createAdapter();
    await adapter.connect();
    try {
      const { descriptor, state } = await selectAvailableRobot(adapter);
      const command = options.createCommand?.(descriptor, state, "execute") ?? defaultCommand(descriptor, state, "EXECUTE");
      const first = await adapter.executeMission(command);
      const duplicate = await adapter.executeMission(structuredClone(command));
      assertCommandReceipt(first, command);
      assertCommandReceipt(duplicate, command);
      if (stableJson(first) !== stableJson(duplicate)) throw new Error("Duplicate commandId did not return the original receipt.");
      if (first.status !== "ACCEPTED") throw new Error(`Conformance command was rejected: ${first.reason ?? "no reason"}`);
    } finally {
      await adapter.disconnect();
    }
  });

  await runCheck(checks, "COMMAND_ID_COLLISION_FENCING", "COMMAND", "command ID collision fencing", async () => {
    const adapter = await options.createAdapter();
    await adapter.connect();
    try {
      const { descriptor, state } = await selectAvailableRobot(adapter);
      const command = options.createCommand?.(descriptor, state, "collision") ?? defaultCommand(descriptor, state, "COLLISION");
      const receipt = await adapter.executeMission(command);
      if (receipt.status !== "ACCEPTED") throw new Error("Collision probe command must be accepted first.");
      const changed = structuredClone(command);
      changed.expiresAt = new Date(new Date(command.expiresAt).getTime() + 1_000).toISOString();
      await expectRejected(() => adapter.executeMission(changed), "Reusing commandId with different content must be rejected.");
    } finally { await adapter.disconnect(); }
  });

  await runCheck(checks, "RECEIPT_LOSS_RECOVERY", "RECOVERY", "accepted command survives a lost transport receipt", async () => {
    const delegate = await options.createAdapter();
    const adapter = new FaultInjectingAdapter(delegate, { executeReceiptLosses: 1 });
    await adapter.connect();
    try {
      const { descriptor, state } = await selectAvailableRobot(adapter);
      const command = options.createCommand?.(descriptor, state, "receipt-loss") ?? defaultCommand(descriptor, state, "RECEIPT-LOSS");
      await expectRejected(() => adapter.executeMission(command), "The fault harness did not drop the first receipt.");
      const replay = await adapter.executeMission(structuredClone(command));
      assertCommandReceipt(replay, command);
      if (replay.status !== "ACCEPTED") throw new Error(`Receipt-loss replay was rejected: ${replay.reason ?? "no reason"}`);
      const recovered = await adapter.getState(command.robotId);
      if (recovered.activeMissionId !== command.missionId || !["RESERVED", "EXECUTING"].includes(recovered.availability)) {
        throw new Error("Adapter duplicated or lost command ownership after the receipt was dropped.");
      }
      await adapter.cancelMission(command.robotId, command.commandId);
    } finally { await adapter.disconnect(); }
  });

  await runCheck(checks, "CANCELLATION_AND_EVENTS", "EVENT", "idempotent cancellation and correlated events", async () => {
    const adapter = await options.createAdapter();
    const events: RobotAdapterEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => {
      assertAdapterEvent(event);
      events.push(structuredClone(event));
    });
    await adapter.connect();
    try {
      const { descriptor, state } = await selectAvailableRobot(adapter);
      const command = options.createCommand?.(descriptor, state, "cancel") ?? defaultCommand(descriptor, state, "CANCEL");
      const execution = await adapter.executeMission(command);
      if (execution.status !== "ACCEPTED") throw new Error(`Conformance command was rejected: ${execution.reason ?? "no reason"}`);
      const first = await adapter.cancelMission(command.robotId, command.commandId);
      const duplicate = await adapter.cancelMission(command.robotId, command.commandId);
      assertCommandReceipt(first, command);
      assertCommandReceipt(duplicate, command);
      if (first.status !== "ACCEPTED") throw new Error(`Cancellation was rejected: ${first.reason ?? "no reason"}`);
      if (stableJson(first) !== stableJson(duplicate)) throw new Error("Duplicate cancellation did not return the original receipt.");
      await waitFor(() => events.some((event) => event.type === "MISSION_STATUS"
        && event.commandId === command.commandId && event.status === "CANCELLED"), options.eventDeliveryTimeoutMs ?? 1_000);
      const stateAfterCancellation = await adapter.getState(command.robotId);
      if (stateAfterCancellation.activeMissionId !== null || stateAfterCancellation.availability !== "AVAILABLE") {
        throw new Error("Robot state did not return to AVAILABLE after cancellation.");
      }
    } finally {
      unsubscribe();
      await adapter.disconnect();
    }
  });

  await runCheck(checks, "RECONNECT_RECONCILIATION", "RECOVERY", "transport reconnect preserves command ownership", async () => {
    const adapter = await options.createAdapter();
    await adapter.connect();
    const { descriptor, state } = await selectAvailableRobot(adapter);
    const command = options.createCommand?.(descriptor, state, "reconnect") ?? defaultCommand(descriptor, state, "RECONNECT");
    const receipt = await adapter.executeMission(command);
    if (receipt.status !== "ACCEPTED") throw new Error("Reconnect probe command was rejected.");
    await adapter.disconnect();
    await adapter.connect();
    try {
      const recovered = await adapter.getState(command.robotId);
      if (recovered.activeMissionId !== command.missionId || !["RESERVED", "EXECUTING"].includes(recovered.availability)) throw new Error("Adapter lost accepted command ownership across reconnect.");
      const replay = await adapter.executeMission(structuredClone(command));
      if (stableJson(replay) !== stableJson(receipt)) throw new Error("Receipt replay changed after reconnect.");
      await adapter.cancelMission(command.robotId, command.commandId);
    } finally { await adapter.disconnect(); }
  });

  await runCheck(checks, "STATE_SEQUENCE_MONOTONICITY", "EVENT", "state sequence does not regress", async () => {
    const adapter = await options.createAdapter();
    await adapter.connect();
    try {
      const { descriptor, state } = await selectAvailableRobot(adapter);
      const command = options.createCommand?.(descriptor, state, "sequence") ?? defaultCommand(descriptor, state, "SEQUENCE");
      const receipt = await adapter.executeMission(command);
      if (receipt.status !== "ACCEPTED") throw new Error("Sequence probe command was rejected.");
      const reserved = await adapter.getState(command.robotId);
      if (reserved.sequence <= state.sequence) throw new Error("State sequence did not advance after command acceptance.");
      const repeated = await adapter.getState(command.robotId);
      if (repeated.sequence < reserved.sequence) throw new Error("State polling returned a regressed sequence.");
      await adapter.cancelMission(command.robotId, command.commandId);
      const cleared = await adapter.getState(command.robotId);
      if (cleared.sequence <= reserved.sequence) throw new Error("State sequence did not advance after cancellation.");
    } finally { await adapter.disconnect(); }
  });

  await runCheck(checks, "OPERATION_DEADLINES", "PERFORMANCE", `basic operations finish within ${operationTimeoutMs}ms`, async () => {
    const adapter = await options.createAdapter();
    await withDeadline(adapter.connect(), operationTimeoutMs, "connect");
    try {
      const descriptors = await withDeadline(adapter.listRobots(), operationTimeoutMs, "listRobots");
      if (!descriptors.length) throw new Error("Deadline probe requires a robot.");
      await withDeadline(adapter.getState(descriptors[0].robotId), operationTimeoutMs, "getState");
    } finally { await withDeadline(adapter.disconnect(), operationTimeoutMs, "disconnect"); }
  });

  return {
    adapterId,
    sdkVersion,
    compliant: checks.every((check) => check.status === "PASS"),
    checkedAt: new Date().toISOString(),
    certificationVersion: "1.0",
    adapterVersion: probe.manifest.adapterVersion,
    protocol: probe.manifest.protocol,
    checks,
  };
}

export async function assertAdapterConformance(options: AdapterConformanceOptions): Promise<AdapterConformanceReport> {
  const report = await runAdapterConformance(options);
  if (!report.compliant) throw new AdapterConformanceError(report);
  return report;
}

async function readAvailableInventory(adapter: RobotAdapter): Promise<{ descriptors: RobotDescriptor[]; states: RobotStateSnapshot[] }> {
  const descriptors = await adapter.listRobots();
  if (descriptors.length === 0) throw new Error("Conformance requires at least one robot.");
  const states = await Promise.all(descriptors.map((descriptor) => adapter.getState(descriptor.robotId)));
  return { descriptors, states };
}

async function selectAvailableRobot(adapter: RobotAdapter): Promise<{ descriptor: RobotDescriptor; state: RobotStateSnapshot }> {
  const inventory = await readAvailableInventory(adapter);
  const index = inventory.states.findIndex((state) => state.connection === "ONLINE" && state.availability === "AVAILABLE");
  if (index < 0) throw new Error("Conformance requires an ONLINE and AVAILABLE robot.");
  return { descriptor: inventory.descriptors[index], state: inventory.states[index] };
}

function defaultCommand(descriptor: RobotDescriptor, state: RobotStateSnapshot, suffix: string): MissionCommand {
  const issuedAt = new Date(state.observedAt);
  return {
    schemaVersion: FLEET_SCHEMA_VERSION,
    commandId: `CONFORMANCE-${suffix}-COMMAND`,
    missionId: `CONFORMANCE-${suffix}-MISSION`,
    robotId: descriptor.robotId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60 * 60 * 1_000).toISOString(),
    mapId: state.pose.mapId,
    steps: [],
  };
}

async function runCheck(checks: AdapterConformanceCheck[], code: AdapterCertificationCode, category: AdapterConformanceCheck["category"], name: string, operation: () => Promise<void>): Promise<void> {
  const startedAt = performance.now();
  try {
    await operation();
    checks.push({ code, category, name, status: "PASS", durationMs: Math.round((performance.now() - startedAt) * 100) / 100, error: null });
  } catch (error) {
    checks.push({ code, category, name, status: "FAIL", durationMs: Math.round((performance.now() - startedAt) * 100) / 100, error: error instanceof Error ? error.message : String(error) });
  }
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms.`)), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function expectRejected(operation: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Expected adapter event was not delivered within ${timeoutMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}
