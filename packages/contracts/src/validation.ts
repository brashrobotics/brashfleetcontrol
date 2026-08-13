import type {
  AlarmActionRequest,
  AssignCapabilityProfileRequest,
  CreateCapabilityProfileRequest,
  CreateInfrastructureResourceRequest,
  CreateMapVersionRequest,
  CreateMissionRequest,
  CreateTrafficRestrictionRequest,
  CreateWorkOrderRequest,
  CreateWorkflowRequest,
  CreateWorkflowTemplateRequest,
  InstantiateWorkflowTemplateRequest,
  InfrastructureReservationPolicy,
  InfrastructureResourceStatus,
  InfrastructureResourceType,
  MapEdgeView,
  MapNodeView,
  MissionLocation,
  UpdateInfrastructureResourceStatusRequest,
  RobotAssignmentConstraints,
  QuarantineRobotRequest,
  ReleaseRobotQuarantineRequest,
  ReassignRecoveryMissionRequest,
  ReplanMissionRouteRequest,
  WorkflowStepDefinition,
  WorkOrderFollowUpAction,
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

function stringArray(value: unknown, path: string, issues: string[], requireOne = false): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return [];
  }
  const result = [...new Set(value.map((item, index) => nonEmptyString(item, `${path}[${index}]`, issues)).filter(Boolean))];
  if (requireOne && result.length === 0) issues.push(`${path} must contain at least one value.`);
  return result;
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

function parseRobotConstraints(value: unknown, path: string, issues: string[]): RobotAssignmentConstraints | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return undefined;
  }
  const requiredAttachments = value.requiredAttachments === undefined ? undefined : stringArray(value.requiredAttachments, `${path}.requiredAttachments`, issues);
  const requiredFloorType = value.requiredFloorType === undefined ? undefined : nonEmptyString(value.requiredFloorType, `${path}.requiredFloorType`, issues);
  const maxRobotWidthMeters = value.maxRobotWidthMeters === undefined ? undefined : finiteNumber(value.maxRobotWidthMeters, `${path}.maxRobotWidthMeters`, issues);
  if (maxRobotWidthMeters !== undefined && maxRobotWidthMeters <= 0) issues.push(`${path}.maxRobotWidthMeters must be greater than 0.`);
  const requiresCancellationSupport = value.requiresCancellationSupport;
  if (requiresCancellationSupport !== undefined && typeof requiresCancellationSupport !== "boolean") issues.push(`${path}.requiresCancellationSupport must be a boolean.`);
  return {
    ...(requiredAttachments ? { requiredAttachments } : {}),
    ...(requiredFloorType ? { requiredFloorType } : {}),
    ...(maxRobotWidthMeters !== undefined ? { maxRobotWidthMeters } : {}),
    ...(typeof requiresCancellationSupport === "boolean" ? { requiresCancellationSupport } : {}),
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
  const preferredRobotId = value.preferredRobotId === undefined
    ? undefined
    : nonEmptyString(value.preferredRobotId, "preferredRobotId", issues);
  const robotConstraints = parseRobotConstraints(value.robotConstraints, "robotConstraints", issues);

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
    ...(preferredRobotId ? { preferredRobotId } : {}),
    ...(robotConstraints ? { robotConstraints } : {}),
    ...(typeof value.autoDispatch === "boolean" ? { autoDispatch: value.autoDispatch } : {}),
  };
}

export function parseCreateWorkOrderRequest(value: unknown): CreateWorkOrderRequest {
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const transport = parseCreateMissionRequest({ ...value, type: "TRANSPORT", autoDispatch: false });
  const issues: string[] = [];
  const name = nonEmptyString(value.name, "name", issues);
  const rawActions = value.followUpActions ?? [];
  const followUpActions: WorkOrderFollowUpAction[] = [];
  if (!Array.isArray(rawActions)) {
    issues.push("followUpActions must be an array when provided.");
  } else if (rawActions.length > 20) {
    issues.push("followUpActions cannot contain more than 20 actions.");
  } else {
    rawActions.forEach((rawAction, index) => {
      const path = `followUpActions[${index}]`;
      if (!isRecord(rawAction)) {
        issues.push(`${path} must be an object.`);
        return;
      }
      const actionId = nonEmptyString(rawAction.actionId, `${path}.actionId`, issues);
      const actionName = nonEmptyString(rawAction.name, `${path}.name`, issues);
      const type = enumValue(rawAction.type, ["WAIT", "CHARGE", "INSPECT", "DOCK"] as const, `${path}.type`, issues);
      const durationSeconds = finiteNumber(rawAction.durationSeconds, `${path}.durationSeconds`, issues);
      if (!Number.isInteger(durationSeconds) || durationSeconds < 1) issues.push(`${path}.durationSeconds must be a positive integer.`);
      const resourceId = rawAction.resourceId === undefined ? undefined : nonEmptyString(rawAction.resourceId, `${path}.resourceId`, issues);
      if (type === "WAIT" && resourceId) issues.push(`${path}.resourceId is not valid for WAIT.`);
      if (type !== "WAIT" && !resourceId) issues.push(`${path}.resourceId is required for ${type}.`);
      followUpActions.push({ actionId, name: actionName, type: type as WorkOrderFollowUpAction["type"], durationSeconds, ...(resourceId ? { resourceId } : {}) });
    });
    if (new Set(followUpActions.map((action) => action.actionId)).size !== followUpActions.length) issues.push("followUpActions actionId values must be unique.");
  }
  if (issues.length) throw new ContractValidationError(issues);
  return {
    name,
    priority: transport.priority,
    requiredCapabilities: transport.requiredCapabilities,
    payloadKg: transport.payloadKg,
    pickup: transport.pickup,
    dropoff: transport.dropoff,
    ...(transport.externalReference ? { externalReference: transport.externalReference } : {}),
    ...(transport.robotConstraints ? { robotConstraints: transport.robotConstraints } : {}),
    ...(followUpActions.length ? { followUpActions } : {}),
  };
}

export function parseCreateCapabilityProfileRequest(value: unknown): CreateCapabilityProfileRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const vendor = nonEmptyString(value.vendor, "vendor", issues);
  const model = nonEmptyString(value.model, "model", issues);
  const version = finiteNumber(value.version, "version", issues);
  if (!Number.isInteger(version) || version < 1) issues.push("version must be a positive integer.");
  const displayName = nonEmptyString(value.displayName, "displayName", issues);
  const actions = stringArray(value.actions, "actions", issues, true);
  const maxPayloadKg = finiteNumber(value.maxPayloadKg, "maxPayloadKg", issues);
  if (maxPayloadKg < 0) issues.push("maxPayloadKg must be non-negative.");
  const allowedZones = stringArray(value.allowedZones, "allowedZones", issues);
  const supportedFloorTypes = stringArray(value.supportedFloorTypes, "supportedFloorTypes", issues, true);
  const attachments = stringArray(value.attachments, "attachments", issues);
  const dimensions = isRecord(value.dimensionsMeters) ? value.dimensionsMeters : (issues.push("dimensionsMeters must be an object."), {});
  const length = finiteNumber(dimensions.length, "dimensionsMeters.length", issues);
  const width = finiteNumber(dimensions.width, "dimensionsMeters.width", issues);
  const height = finiteNumber(dimensions.height, "dimensionsMeters.height", issues);
  const turningRadius = finiteNumber(dimensions.turningRadius, "dimensionsMeters.turningRadius", issues);
  if ([length, width, height].some((number) => number <= 0) || turningRadius < 0) issues.push("Robot dimensions must be positive and turningRadius must be non-negative.");
  if (typeof value.supportsCancellation !== "boolean") issues.push("supportsCancellation must be a boolean.");
  const adapterProtocolVersion = nonEmptyString(value.adapterProtocolVersion, "adapterProtocolVersion", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length) throw new ContractValidationError(issues);
  return { vendor, model, version, displayName, actions, maxPayloadKg, allowedZones, dimensionsMeters: { length, width, height, turningRadius }, supportedFloorTypes, attachments, supportsCancellation: value.supportsCancellation as boolean, adapterProtocolVersion, operatorId };
}

export function parseAssignCapabilityProfileRequest(value: unknown): AssignCapabilityProfileRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const profileId = nonEmptyString(value.profileId, "profileId", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length) throw new ContractValidationError(issues);
  return { profileId, operatorId };
}

export function parseQuarantineRobotRequest(value: unknown): QuarantineRobotRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const reason = nonEmptyString(value.reason, "reason", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length) throw new ContractValidationError(issues);
  return { reason, operatorId };
}

export function parseReleaseRobotQuarantineRequest(value: unknown): ReleaseRobotQuarantineRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const inspectionReference = nonEmptyString(value.inspectionReference, "inspectionReference", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length) throw new ContractValidationError(issues);
  return { inspectionReference, operatorId };
}

export function parseReassignRecoveryMissionRequest(value: unknown): ReassignRecoveryMissionRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  if (value.commandCleared !== true) issues.push("commandCleared must be true before recovery reassignment.");
  const clearanceEvidence = nonEmptyString(value.clearanceEvidence, "clearanceEvidence", issues);
  const targetRobotId = value.targetRobotId === undefined ? undefined : nonEmptyString(value.targetRobotId, "targetRobotId", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  if (issues.length) throw new ContractValidationError(issues);
  return { commandCleared: true, clearanceEvidence, ...(targetRobotId ? { targetRobotId } : {}), operatorId };
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

export function parseCreateWorkflowTemplateRequest(value: unknown): CreateWorkflowTemplateRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const templateKey = nonEmptyString(value.templateKey, "templateKey", issues);
  if (templateKey && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateKey)) issues.push("templateKey must be lowercase kebab-case.");
  const version = finiteNumber(value.version, "version", issues);
  if (!Number.isInteger(version) || version < 1) issues.push("version must be a positive integer.");
  const name = nonEmptyString(value.name, "name", issues);
  const description = nonEmptyString(value.description, "description", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  const parameters = Array.isArray(value.parameters) ? value.parameters.map((parameter, index) => {
    const path = `parameters[${index}]`;
    if (!isRecord(parameter)) {
      issues.push(`${path} must be an object.`);
      return { name: "", required: false };
    }
    const parameterName = nonEmptyString(parameter.name, `${path}.name`, issues);
    if (parameterName && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(parameterName)) issues.push(`${path}.name is invalid.`);
    if (typeof parameter.required !== "boolean") issues.push(`${path}.required must be a boolean.`);
    const defaultValue = parameter.defaultValue === undefined ? undefined : nonEmptyString(parameter.defaultValue, `${path}.defaultValue`, issues);
    const allowedValues = parameter.allowedValues === undefined ? undefined : Array.isArray(parameter.allowedValues)
      ? parameter.allowedValues.map((entry, allowedIndex) => nonEmptyString(entry, `${path}.allowedValues[${allowedIndex}]`, issues))
      : (issues.push(`${path}.allowedValues must be an array.`), undefined);
    if (allowedValues && new Set(allowedValues).size !== allowedValues.length) issues.push(`${path}.allowedValues must be unique.`);
    if (defaultValue && allowedValues && !allowedValues.includes(defaultValue)) issues.push(`${path}.defaultValue must be allowed.`);
    return { name: parameterName, required: parameter.required === true, ...(defaultValue ? { defaultValue } : {}), ...(allowedValues ? { allowedValues } : {}) };
  }) : (issues.push("parameters must be an array."), []);
  const parameterNames = new Set<string>();
  for (const parameter of parameters) {
    if (parameterNames.has(parameter.name)) issues.push(`parameter ${parameter.name} is duplicated.`);
    parameterNames.add(parameter.name);
  }
  let steps: WorkflowStepDefinition[] = [];
  try {
    steps = parseCreateWorkflowRequest({ name, steps: value.steps }).steps;
  } catch (error) {
    if (error instanceof ContractValidationError) issues.push(...error.issues);
  }
  const placeholders = JSON.stringify(value.steps ?? []).matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g);
  for (const match of placeholders) if (!parameterNames.has(match[1])) issues.push(`template references unknown parameter ${match[1]}.`);
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { templateKey, version, name, description, parameters, steps, operatorId };
}

export function parseInstantiateWorkflowTemplateRequest(value: unknown): InstantiateWorkflowTemplateRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const name = value.name === undefined ? undefined : nonEmptyString(value.name, "name", issues);
  const externalReference = value.externalReference === undefined ? undefined : nonEmptyString(value.externalReference, "externalReference", issues);
  const parameters: Record<string, string> = {};
  if (!isRecord(value.parameters)) issues.push("parameters must be an object.");
  else for (const [key, entry] of Object.entries(value.parameters)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || typeof entry !== "string" || !entry) issues.push(`parameters.${key} must be a non-empty string.`);
    else parameters[key] = entry;
  }
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { ...(name ? { name } : {}), ...(externalReference ? { externalReference } : {}), parameters };
}

export function parseReplanMissionRouteRequest(value: unknown): ReplanMissionRouteRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);
  const reason = nonEmptyString(value.reason, "reason", issues);
  const operatorId = nonEmptyString(value.operatorId, "operatorId", issues);
  const excludedResourceIds = value.excludedResourceIds === undefined ? undefined : Array.isArray(value.excludedResourceIds)
    ? [...new Set(value.excludedResourceIds.map((entry, index) => nonEmptyString(entry, `excludedResourceIds[${index}]`, issues)))]
    : (issues.push("excludedResourceIds must be an array."), undefined);
  if (excludedResourceIds?.some((resource) => !/^(edge|node):[A-Za-z0-9._:-]+$/.test(resource))) {
    issues.push("excludedResourceIds entries must use edge: or node: identifiers.");
  }
  if (issues.length > 0) throw new ContractValidationError(issues);
  return { reason, operatorId, ...(excludedResourceIds ? { excludedResourceIds } : {}) };
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
