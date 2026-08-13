import { FLEET_SCHEMA_VERSION, type MissionCommand, type RobotAdapterEvent, type RobotDescriptor, type RobotStateSnapshot } from "@brash/contracts";
import { assertAdapterInventory, assertAdapterEvent, assertCommandReceipt } from "../adapter/canonical-validation.js";
import { assertAdapterManifest } from "../adapter/adapter-manifest.js";
import type { RobotAdapter } from "../adapter/robot-adapter.js";

export interface AdapterConformanceOptions {
  createAdapter: () => RobotAdapter | Promise<RobotAdapter>;
  createCommand?: (descriptor: RobotDescriptor, state: RobotStateSnapshot, checkName: string) => MissionCommand;
  eventDeliveryTimeoutMs?: number;
}

export interface AdapterConformanceCheck {
  name: string;
  status: "PASS" | "FAIL";
  durationMs: number;
  error: string | null;
}

export interface AdapterConformanceReport {
  adapterId: string;
  sdkVersion: string;
  compliant: boolean;
  checkedAt: string;
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

  await runCheck(checks, "manifest", async () => {
    assertAdapterManifest(probe.manifest);
    if (probe.adapterId !== probe.manifest.adapterId) throw new Error("adapterId must match manifest.adapterId.");
  });

  await runCheck(checks, "connection lifecycle and canonical inventory", async () => {
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

  await runCheck(checks, "idempotent mission receipt", async () => {
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

  await runCheck(checks, "idempotent cancellation and correlated events", async () => {
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

  return {
    adapterId,
    sdkVersion,
    compliant: checks.every((check) => check.status === "PASS"),
    checkedAt: new Date().toISOString(),
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

async function runCheck(checks: AdapterConformanceCheck[], name: string, operation: () => Promise<void>): Promise<void> {
  const startedAt = performance.now();
  try {
    await operation();
    checks.push({ name, status: "PASS", durationMs: Math.round((performance.now() - startedAt) * 100) / 100, error: null });
  } catch (error) {
    checks.push({ name, status: "FAIL", durationMs: Math.round((performance.now() - startedAt) * 100) / 100, error: error instanceof Error ? error.message : String(error) });
  }
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

