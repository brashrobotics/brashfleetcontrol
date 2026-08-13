import type {
  AlarmActionRequest,
  CreateInfrastructureResourceRequest,
  CreateMapVersionRequest,
  CreateMissionRequest,
  CreateTrafficRestrictionRequest,
  CreateWorkflowRequest,
  InfrastructureReservationPolicy,
  InfrastructureResourceStatus,
  InfrastructureResourceType,
  MapEdgeView,
  MapNodeView,
  MissionLocation,
  UpdateInfrastructureResourceStatusRequest,
  WorkflowStepDefinition,
} from "./fleet-contracts.js";

export class ContractValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super("The request does not satisfy the Fleet contract.");
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path} must be a non-empty string.`);
    return "";
  }
  return value.trim();
}

function finiteNumber(value: unknown, path: string, issues: string[]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${path} must be a finite number.`);
    return 0;
  }
  return value;
}

function parseLocation(value: unknown, path: string, issues: string[]): MissionLocation {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return { stationId: "", mapId: "", x: 0, y: 0 };
  }

  const zoneId = value.zoneId === undefined
    ? undefined
    : nonEmptyString(value.zoneId, `${path}.zoneId`, issues);

  return {
    stationId: nonEmptyString(value.stationId, `${path}.stationId`, issues),
    mapId: nonEmptyString(value.mapId, `${path}.mapId`, issues),
    x: finiteNumber(value.x, `${path}.x`, issues),
    y: finiteNumber(value.y, `${path}.y`, issues),
    ...(zoneId ? { zoneId } : {}),
  };
}

export function parseCreateMissionRequest(value: unknown): CreateMissionRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);

  if (value.type !== "TRANSPORT") issues.push("type must be TRANSPORT.");

  const priority = finiteNumber(value.priority, "priority", issues);
  if (priority < 0 || priority > 100) issues.push("priority must be between 0 and 100.");

  const payloadKg = finiteNumber(value.payloadKg, "payloadKg", issues);
  if (payloadKg < 0) issues.push("payloadKg must be greater than or equal to 0.");

  const rawCapabilities = value.requiredCapabilities;
  let requiredCapabilities: string[] = [];
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length === 0) {
    issues.push("requiredCapabilities must contain at least one capability.");
  } else {
    requiredCapabilities = [...new Set(rawCapabilities.map((item, index) =>
      nonEmptyString(item, `requiredCapabilities[${index}]`, issues),
    ).filter(Boolean))];
  }

  const pickup = parseLocation(value.pickup, "pickup", issues);
  const dropoff = parseLocation(value.dropoff, "dropoff", issues);
  if (pickup.mapId && dropoff.mapId && pickup.mapId !== dropoff.mapId) {
    issues.push("pickup.mapId and dropoff.mapId must match in the first Fleet contract version.");
  }

  const externalReference = value.externalReference === undefined
    ? undefined
    : nonEmptyString(value.externalReference, "externalReference", issues);

  if (value.autoDispatch !== undefined && typeof value.autoDispatch !== "boolean") {
    issues.push("autoDispatch must be a boolean when provided.");
  }

  if (issues.length > 0) throw new ContractValidationError(issues);

  return {
    type: "TRANSPORT",
    priority,
    payloadKg,
    requiredCapabilities,
    pickup,
    dropoff,
    ...(externalReference ? { externalReference } : {}),
    ...(typeof value.autoDispatch === "boolean" ? { autoDispatch: value.autoDispatch } : {}),
  };
}

export function parseAlarmActionRequest(value: unknown): AlarmActionRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  const note = value.note === undefined ? undefined : nonEmptyString(value.note, "note", issues);
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { operatorId, ...(note ? { note } : {}) };
}

export function parseCreateTrafficRestrictionRequest(value: unknown): CreateTrafficRestrictionRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const mapId = nonEmptyString(value.mapId, "mapId", issues);
  const resourceId = nonEmptyString(value.resourceId, "resourceId", issues);
  if (resourceId && !/^(edge|node):[^:]+$/.test(resourceId)) issues.push("resourceId must use edge:ID or node:ID format.");
  const reason = nonEmptyString(value.reason, "reason", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { mapId, resourceId, reason, operatorId };
}

export function parseCreateMapVersionRequest(value: unknown): CreateMapVersionRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const familyId = nonEmptyString(value.familyId, "familyId", issues);
  if (familyId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(familyId)) issues.push("familyId must be a lowercase kebab-case identifier.");
  const displayName = nonEmptyString(value.displayName, "displayName", issues);
  const revision = finiteNumber(value.revision, "revision", issues);
  if (!Number.isInteger(revision) || revision < 1) issues.push("revision must be a positive integer.");
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  const nodes = parseMapNodes(value.nodes, issues);
  const edges = parseMapEdges(value.edges, issues);
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { familyId, displayName, revision, nodes, edges, operatorId };
}

export function parseCreateInfrastructureResourceRequest(value: unknown): CreateInfrastructureResourceRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const resourceId = nonEmptyString(value.resourceId, "resourceId", issues);
  if (resourceId && !/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(resourceId)) issues.push("resourceId contains unsupported characters.");
  const mapId = nonEmptyString(value.mapId, "mapId", issues);
  const displayName = nonEmptyString(value.displayName, "displayName", issues);
  const type = enumValue(value.type, ["DOOR", "ELEVATOR", "CHARGER", "DOCK", "WORKCELL"] as const, "type", issues);
  const reservationPolicy = enumValue(value.reservationPolicy, ["TRANSIT_EXCLUSIVE", "SERVICE_EXCLUSIVE"] as const, "reservationPolicy", issues);
  const edgeId = value.edgeId === undefined ? undefined : nonEmptyString(value.edgeId, "edgeId", issues);
  const nodeId = value.nodeId === undefined ? undefined : nonEmptyString(value.nodeId, "nodeId", issues);
  if (Boolean(edgeId) === Boolean(nodeId)) issues.push("exactly one of edgeId or nodeId is required.");
  if (reservationPolicy === "TRANSIT_EXCLUSIVE" && !edgeId && !nodeId) issues.push("transit resources require a map binding.");
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { resourceId, mapId, displayName, type: type as InfrastructureResourceType, reservationPolicy: reservationPolicy as InfrastructureReservationPolicy, ...(edgeId ? { edgeId } : {}), ...(nodeId ? { nodeId } : {}), operatorId };
}

export function parseUpdateInfrastructureResourceStatusRequest(value: unknown): UpdateInfrastructureResourceStatusRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const status = enumValue(value.status, ["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"] as const, "status", issues);
  const reason = nonEmptyString(value.reason, "reason", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { status: status as InfrastructureResourceStatus, reason, operatorId };
}

export function parseCreateWorkflowRequest(value: unknown): CreateWorkflowRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const name = nonEmptyString(value.name, "name", issues);
  const externalReference = value.externalReference === undefined ? undefined : nonEmptyString(value.externalReference, "externalReference", issues);
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    issues.push("steps must contain at least one workflow step.");
  }
  const steps = Array.isArray(value.steps) ? value.steps.map((step, index) => parseWorkflowStep(step, index, issues)) : [];
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.stepId)) issues.push(`stepId ${step.stepId} is duplicated.`);
    stepIds.add(step.stepId);
  }
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) issues.push(`${step.stepId} depends on unknown step ${dependency}.`);
      if (dependency === step.stepId) issues.push(`${step.stepId} cannot depend on itself.`);
    }
  }
  if (!hasAcyclicDependencies(steps)) issues.push("workflow step dependencies must form an acyclic graph.");
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { name, ...(externalReference ? { externalReference } : {}), steps };
}

function parseWorkflowStep(value: unknown, index: number, issues: string[]): WorkflowStepDefinition {
  const path = `steps[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return { stepId: "", name: "", type: "WAIT", dependsOn: [], timeoutSeconds: 1, maxAttempts: 1, retryDelaySeconds: 0, durationSeconds: 1 };
  }
  const stepId = nonEmptyString(value.stepId, `${path}.stepId`, issues);
  const name = nonEmptyString(value.name, `${path}.name`, issues);
  const type = enumValue(value.type, ["TRANSPORT", "WAIT", "CHARGE", "INSPECT", "DOCK"] as const, `${path}.type`, issues) || "WAIT";
  const timeoutSeconds = finiteNumber(value.timeoutSeconds, `${path}.timeoutSeconds`, issues);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) issues.push(`${path}.timeoutSeconds must be a positive integer.`);
  const maxAttempts = finiteNumber(value.maxAttempts, `${path}.maxAttempts`, issues);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) issues.push(`${path}.maxAttempts must be an integer between 1 and 100.`);
  const retryDelaySeconds = finiteNumber(value.retryDelaySeconds, `${path}.retryDelaySeconds`, issues);
  if (!Number.isInteger(retryDelaySeconds) || retryDelaySeconds < 0) issues.push(`${path}.retryDelaySeconds must be a non-negative integer.`);
  const dependsOn = Array.isArray(value.dependsOn)
    ? [...new Set(value.dependsOn.map((dependency, dependencyIndex) => nonEmptyString(dependency, `${path}.dependsOn[${dependencyIndex}]`, issues)).filter(Boolean))]
    : (issues.push(`${path}.dependsOn must be an array.`), []);
  let mission: CreateMissionRequest | undefined;
  if (type !== "WAIT") {
    try {
      mission = parseCreateMissionRequest(value.mission);
    } catch (error) {
      if (error instanceof ContractValidationError) issues.push(...error.issues.map((issue) => `${path}.mission.${issue}`));
    }
  } else if (value.mission !== undefined) issues.push(`${path}.mission is not allowed for WAIT steps.`);
  const resourceId = value.resourceId === undefined ? undefined : nonEmptyString(value.resourceId, `${path}.resourceId`, issues);
  const durationSeconds = value.durationSeconds === undefined ? undefined : finiteNumber(value.durationSeconds, `${path}.durationSeconds`, issues);
  if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds < 1)) issues.push(`${path}.durationSeconds must be a positive integer.`);
  if (type === "WAIT" && durationSeconds === undefined) issues.push(`${path}.durationSeconds is required for WAIT steps.`);
  if (["CHARGE", "INSPECT", "DOCK"].includes(type) && (!resourceId || durationSeconds === undefined)) issues.push(`${path}.resourceId and durationSeconds are required for ${type} steps.`);
  if (type === "TRANSPORT" && (resourceId || durationSeconds !== undefined)) issues.push(`${path}.resourceId and durationSeconds are not allowed for TRANSPORT steps.`);
  return {
    stepId, name, type, dependsOn, timeoutSeconds, maxAttempts, retryDelaySeconds,
    ...(mission ? { mission } : {}), ...(resourceId ? { resourceId } : {}), ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
}

function hasAcyclicDependencies(steps: WorkflowStepDefinition[]): boolean {
  const dependencies = new Map(steps.map((step) => [step.stepId, step.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visited.has(stepId)) return true;
    if (visiting.has(stepId)) return false;
    visiting.add(stepId);
    for (const dependency of dependencies.get(stepId) ?? []) if (!visit(dependency)) return false;
    visiting.delete(stepId);
    visited.add(stepId);
    return true;
  };
  return steps.every((step) => visit(step.stepId));
}

function parseMapNodes(value: unknown, issues: string[]): MapNodeView[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push("nodes must contain at least one map node.");
    return [];
  }
  return value.map((item, index) => {
    const path = `nodes[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path} must be an object.`);
      return { nodeId: "", label: "", kind: "WAYPOINT", x: 0, y: 0 };
    }
    const kind = enumValue(item.kind, ["WAYPOINT", "INTERSECTION", "STATION", "HOLDING_POINT"] as const, `${path}.kind`, issues);
    const stationId = item.stationId === undefined ? undefined : nonEmptyString(item.stationId, `${path}.stationId`, issues);
    const zoneId = item.zoneId === undefined ? undefined : nonEmptyString(item.zoneId, `${path}.zoneId`, issues);
    return {
      nodeId: nonEmptyString(item.nodeId, `${path}.nodeId`, issues),
      label: nonEmptyString(item.label, `${path}.label`, issues),
      kind: kind as MapNodeView["kind"],
      x: finiteNumber(item.x, `${path}.x`, issues),
      y: finiteNumber(item.y, `${path}.y`, issues),
      ...(stationId ? { stationId } : {}),
      ...(zoneId ? { zoneId } : {}),
    };
  });
}

function parseMapEdges(value: unknown, issues: string[]): MapEdgeView[] {
  if (!Array.isArray(value)) {
    issues.push("edges must be an array.");
    return [];
  }
  return value.map((item, index) => {
    const path = `edges[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path} must be an object.`);
      return { edgeId: "", fromNodeId: "", toNodeId: "", directed: false, lengthMeters: 0, travelTimeSeconds: 0 };
    }
    if (typeof item.directed !== "boolean") issues.push(`${path}.directed must be a boolean.`);
    return {
      edgeId: nonEmptyString(item.edgeId, `${path}.edgeId`, issues),
      fromNodeId: nonEmptyString(item.fromNodeId, `${path}.fromNodeId`, issues),
      toNodeId: nonEmptyString(item.toNodeId, `${path}.toNodeId`, issues),
      directed: typeof item.directed === "boolean" ? item.directed : false,
      lengthMeters: finiteNumber(item.lengthMeters, `${path}.lengthMeters`, issues),
      travelTimeSeconds: finiteNumber(item.travelTimeSeconds, `${path}.travelTimeSeconds`, issues),
    };
  });
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, path: string, issues: string[]): T[number] | "" {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(`${path} must be one of ${allowed.join(", ")}.`);
    return "";
  }
  return value as T[number];
}
