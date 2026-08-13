import { createHash } from "node:crypto";
import type { TrafficReservationSnapshot } from "@brash/domain";
import { createTestFleetSystem, robotFixture, transportMissionFixture } from "@brash/test-kit";

export type DigitalTwinScenarioKind =
  | "NOMINAL_THROUGHPUT"
  | "CONGESTION_REPLAN"
  | "ROBOT_LOSS_RECOVERY"
  | "INFRASTRUCTURE_OUTAGE";

export interface DigitalTwinThresholds {
  minimumCompletionRate?: number;
  maximumReservationOverlaps?: number;
  maximumDuplicateCommandEvents?: number;
  minimumCriticalAlarms?: number;
  maximumCriticalAlarms?: number;
  minimumSafetyHolds?: number;
  minimumRecoveryRequiredMissions?: number;
  minimumRouteRevisions?: number;
}

export interface DigitalTwinScenarioDefinition {
  schemaVersion: 1;
  scenarioId: string;
  kind: DigitalTwinScenarioKind;
  robotCount: number;
  missionCount: number;
  thresholds: DigitalTwinThresholds;
}

export interface DigitalTwinMetrics {
  submittedMissions: number;
  completedMissions: number;
  completionRate: number;
  reservationOverlaps: number;
  duplicateCommandEvents: number;
  criticalAlarms: number;
  safetyHolds: number;
  recoveryRequiredMissions: number;
  routeRevisions: number;
}

export interface DigitalTwinCheck {
  metric: keyof DigitalTwinMetrics;
  comparison: "MINIMUM" | "MAXIMUM";
  expected: number;
  actual: number;
  passed: boolean;
}

export interface DigitalTwinScenarioResult {
  scenarioId: string;
  scenarioHash: string;
  kind: DigitalTwinScenarioKind;
  passed: boolean;
  durationMs: number;
  metrics: DigitalTwinMetrics;
  checks: DigitalTwinCheck[];
  errors: string[];
}

export interface DigitalTwinAcceptanceReport {
  reportVersion: 1;
  generatedAt: string;
  release: string;
  topology: string;
  passed: boolean;
  scenarios: DigitalTwinScenarioResult[];
  summary: { total: number; passed: number; failed: number };
}

export async function runDigitalTwinAcceptance(
  definitions: DigitalTwinScenarioDefinition[],
  options: { release?: string; generatedAt?: Date } = {},
): Promise<DigitalTwinAcceptanceReport> {
  if (!definitions.length) throw new Error("At least one digital-twin scenario is required.");
  const ids = new Set<string>();
  for (const definition of definitions) {
    validateScenario(definition);
    if (ids.has(definition.scenarioId)) throw new Error(`Duplicate digital-twin scenario ID: ${definition.scenarioId}`);
    ids.add(definition.scenarioId);
  }
  const scenarios: DigitalTwinScenarioResult[] = [];
  for (const definition of definitions) scenarios.push(await runScenario(definition));
  const passed = scenarios.filter((scenario) => scenario.passed).length;
  return {
    reportVersion: 1,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    release: options.release ?? "unversioned",
    topology: "plant-a@1",
    passed: passed === scenarios.length,
    scenarios,
    summary: { total: scenarios.length, passed, failed: scenarios.length - passed },
  };
}

export function validateScenario(value: DigitalTwinScenarioDefinition): void {
  if (value.schemaVersion !== 1) throw new Error(`${value.scenarioId || "scenario"}: schemaVersion must be 1.`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.scenarioId)) throw new Error("scenarioId must be lowercase kebab-case.");
  if (!["NOMINAL_THROUGHPUT", "CONGESTION_REPLAN", "ROBOT_LOSS_RECOVERY", "INFRASTRUCTURE_OUTAGE"].includes(value.kind)) {
    throw new Error(`${value.scenarioId}: unsupported scenario kind.`);
  }
  for (const [name, candidate] of [["robotCount", value.robotCount], ["missionCount", value.missionCount]] as const) {
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > 100) throw new Error(`${value.scenarioId}: ${name} must be an integer between 1 and 100.`);
  }
  for (const [name, candidate] of Object.entries(value.thresholds)) {
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) throw new Error(`${value.scenarioId}: threshold ${name} must be non-negative.`);
  }
}

async function runScenario(definition: DigitalTwinScenarioDefinition): Promise<DigitalTwinScenarioResult> {
  const startedAt = performance.now();
  const scenarioHash = createHash("sha256").update(stableJson(definition)).digest("hex");
  try {
    const metrics = definition.kind === "NOMINAL_THROUGHPUT"
      ? await nominalThroughput(definition)
      : definition.kind === "CONGESTION_REPLAN"
        ? await congestionReplan(definition)
        : definition.kind === "ROBOT_LOSS_RECOVERY"
          ? await robotLossRecovery(definition)
          : await infrastructureOutage(definition);
    const checks = thresholdChecks(metrics, definition.thresholds);
    return {
      scenarioId: definition.scenarioId, scenarioHash, kind: definition.kind,
      passed: checks.every((check) => check.passed), durationMs: rounded(performance.now() - startedAt),
      metrics, checks, errors: [],
    };
  } catch (error) {
    return {
      scenarioId: definition.scenarioId, scenarioHash, kind: definition.kind,
      passed: false, durationMs: rounded(performance.now() - startedAt),
      metrics: emptyMetrics(), checks: [], errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function nominalThroughput(definition: DigitalTwinScenarioDefinition): Promise<DigitalTwinMetrics> {
  const system = createTestFleetSystem({ robots: robots(definition.robotCount, "NOMINAL") });
  await system.core.start();
  try {
    let submitted = 0;
    let observedOverlaps = 0;
    for (let offset = 0; offset < definition.missionCount; offset += definition.robotCount) {
      const batchSize = Math.min(definition.robotCount, definition.missionCount - offset);
      const dispatched = [];
      for (let index = 0; index < batchSize; index += 1) {
        const missionNumber = offset + index + 1;
        const mission = await system.core.createMission(transportMissionFixture({ externalReference: `${definition.scenarioId}-${missionNumber}` }));
        dispatched.push(await system.core.dispatchMission(mission.missionId));
        submitted += 1;
      }
      observedOverlaps += overlapCount(await system.traffic.listActiveReservations("plant-a@1", system.clock.now()));
      for (const dispatch of dispatched) {
        if (!dispatch.mission.commandId) throw new Error(`${dispatch.mission.missionId} has no simulator command.`);
        await system.adapter.startMission(dispatch.mission.commandId);
        await system.adapter.completeMission(dispatch.mission.commandId);
      }
    }
    const metrics = await collectMetrics(system, submitted);
    metrics.reservationOverlaps = observedOverlaps;
    return metrics;
  } finally {
    await system.core.stop();
  }
}

async function congestionReplan(definition: DigitalTwinScenarioDefinition): Promise<DigitalTwinMetrics> {
  const system = createTestFleetSystem({ robots: robots(definition.robotCount, "CONGESTION") });
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture({ externalReference: definition.scenarioId }));
    const dispatch = await system.core.dispatchMission(mission.missionId);
    if (!dispatch.route) throw new Error("Initial congestion scenario route is missing.");
    const segment = dispatch.route.segments.find((entry) => ["E-CENTER-NORTH", "E-NORTH-02"].includes(entry.edgeId));
    if (!segment) throw new Error("Scenario route has no bypassable edge.");
    await system.core.createTrafficRestriction({
      mapId: "plant-a@1", resourceId: `edge:${segment.edgeId}`,
      reason: "Digital-twin congestion injection", operatorId: "digital-twin",
    });
    const current = await system.core.getMissionRoute(mission.missionId);
    if (!current || current.routeId === dispatch.route?.routeId || current.segments.some((entry) => entry.edgeId === segment.edgeId)) {
      throw new Error("Congestion did not produce a valid replacement route.");
    }
    return collectMetrics(system, 1);
  } finally {
    await system.core.stop();
  }
}

async function robotLossRecovery(definition: DigitalTwinScenarioDefinition): Promise<DigitalTwinMetrics> {
  const system = createTestFleetSystem({ robots: robots(definition.robotCount, "LOSS") });
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture({ externalReference: definition.scenarioId }));
    await system.core.dispatchMission(mission.missionId);
    system.clock.advance(30_001);
    await system.core.processFleetRecovery();
    return collectMetrics(system, 1);
  } finally {
    await system.core.stop();
  }
}

async function infrastructureOutage(definition: DigitalTwinScenarioDefinition): Promise<DigitalTwinMetrics> {
  const system = createTestFleetSystem({ robots: robots(definition.robotCount, "INFRA") });
  await system.core.start();
  try {
    await system.core.createInfrastructureResource({
      resourceId: "DIGITAL-DOOR-CENTER", mapId: "plant-a@1", displayName: "Digital Twin Door",
      type: "DOOR", reservationPolicy: "TRANSIT_EXCLUSIVE", edgeId: "E-CENTER-NORTH", operatorId: "digital-twin",
    });
    const mission = await system.core.createMission(transportMissionFixture({ externalReference: definition.scenarioId }));
    const dispatch = await system.core.dispatchMission(mission.missionId);
    if (!dispatch.route) throw new Error("Initial infrastructure scenario route is missing.");
    const persistedRoute = await system.traffic.getByMission(mission.missionId);
    if (!persistedRoute?.reservations.some((reservation) => reservation.resourceId === "infrastructure:DIGITAL-DOOR-CENTER")) {
      throw new Error("Initial route did not reserve the injected infrastructure resource.");
    }
    await system.core.updateInfrastructureResourceStatus("DIGITAL-DOOR-CENTER", "UNAVAILABLE", "Injected door controller outage", "digital-twin");
    const current = await system.core.getMissionRoute(mission.missionId);
    if (!current || current.routeId === dispatch.route.routeId || current.segments.some((entry) => entry.edgeId === "E-CENTER-NORTH")) {
      throw new Error("Infrastructure outage did not produce a bypass route.");
    }
    return collectMetrics(system, 1);
  } finally {
    await system.core.stop();
  }
}

async function collectMetrics(system: ReturnType<typeof createTestFleetSystem>, submittedMissions: number): Promise<DigitalTwinMetrics> {
  const snapshot = await system.core.getSnapshot();
  const plans = await system.traffic.listByMap("plant-a@1");
  const reservations = plans.flatMap((plan) => plan.reservations);
  const events = (await Promise.all(snapshot.missions.map((mission) => system.core.getMissionEvents(mission.missionId)))).flat();
  const commandIds = events.filter((event) => event.type === "COMMAND_DISPATCHED" && event.commandId).map((event) => event.commandId!);
  const commandCounts = new Map<string, number>();
  for (const commandId of commandIds) commandCounts.set(commandId, (commandCounts.get(commandId) ?? 0) + 1);
  const alarms = await system.core.getAlarms();
  const completedMissions = snapshot.missions.filter((mission) => mission.state === "COMPLETED").length;
  return {
    submittedMissions,
    completedMissions,
    completionRate: submittedMissions === 0 ? 0 : rounded(completedMissions / submittedMissions, 6),
    reservationOverlaps: overlapCount(reservations),
    duplicateCommandEvents: [...commandCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0),
    criticalAlarms: alarms.alarms.filter((alarm) => alarm.severity === "CRITICAL").length,
    safetyHolds: plans.filter((plan) => plan.status === "SAFETY_HOLD").length,
    recoveryRequiredMissions: snapshot.missions.filter((mission) => mission.state === "RECOVERY_REQUIRED").length,
    routeRevisions: (await Promise.all(snapshot.missions.map((mission) => system.core.listMissionRouteRevisions(mission.missionId)))).flat().length,
  };
}

function thresholdChecks(metrics: DigitalTwinMetrics, thresholds: DigitalTwinThresholds): DigitalTwinCheck[] {
  const mapping: Array<[keyof DigitalTwinThresholds, keyof DigitalTwinMetrics, "MINIMUM" | "MAXIMUM"]> = [
    ["minimumCompletionRate", "completionRate", "MINIMUM"],
    ["maximumReservationOverlaps", "reservationOverlaps", "MAXIMUM"],
    ["maximumDuplicateCommandEvents", "duplicateCommandEvents", "MAXIMUM"],
    ["minimumCriticalAlarms", "criticalAlarms", "MINIMUM"],
    ["maximumCriticalAlarms", "criticalAlarms", "MAXIMUM"],
    ["minimumSafetyHolds", "safetyHolds", "MINIMUM"],
    ["minimumRecoveryRequiredMissions", "recoveryRequiredMissions", "MINIMUM"],
    ["minimumRouteRevisions", "routeRevisions", "MINIMUM"],
  ];
  return mapping.flatMap(([thresholdName, metric, comparison]) => {
    const expected = thresholds[thresholdName];
    if (expected === undefined) return [];
    const actual = metrics[metric];
    return [{ metric, comparison, expected, actual, passed: comparison === "MINIMUM" ? actual >= expected : actual <= expected }];
  });
}

function overlapCount(reservations: TrafficReservationSnapshot[]): number {
  let overlaps = 0;
  for (let leftIndex = 0; leftIndex < reservations.length; leftIndex += 1) {
    const left = reservations[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < reservations.length; rightIndex += 1) {
      const right = reservations[rightIndex];
      if (left.missionId === right.missionId || left.resourceId !== right.resourceId || left.mapId !== right.mapId) continue;
      if (left.startsAt < right.endsAt && right.startsAt < left.endsAt) overlaps += 1;
    }
  }
  return overlaps;
}

function robots(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => robotFixture({
    robotId: `DT-${prefix}-${String(index + 1).padStart(2, "0")}`,
    displayName: `Digital Twin ${index + 1}`,
    x: 10,
    y: 5,
    capabilities: ["pallet_transport"],
  }));
}

function emptyMetrics(): DigitalTwinMetrics {
  return { submittedMissions: 0, completedMissions: 0, completionRate: 0, reservationOverlaps: 0, duplicateCommandEvents: 0, criticalAlarms: 0, safetyHolds: 0, recoveryRequiredMissions: 0, routeRevisions: 0 };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function rounded(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
