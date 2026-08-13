import {
  VDA5050_VERSION,
  type Vda5050Action,
  type Vda5050Connection,
  type Vda5050Identity,
  type Vda5050InstantActions,
  type Vda5050Order,
  type Vda5050State,
} from "./vda5050-types.js";

/** Validates the VDA 5050 v3 fields consumed by BRASH's supported profile. */
export function parseVda5050State(payload: string, expected?: Vda5050Identity): Vda5050State {
  const raw = parseObject(payload, "state");
  const value = raw as unknown as Vda5050State;
  assertHeader(raw, "state", expected);
  string(value.orderId, "state.orderId", true);
  integer(value.orderUpdateId, "state.orderUpdateId");
  string(value.lastNodeId, "state.lastNodeId", true);
  integer(value.lastNodeSequenceId, "state.lastNodeSequenceId");
  array(value.nodeStates, "state.nodeStates");
  array(value.edgeStates, "state.edgeStates");
  boolean(value.driving, "state.driving");
  array(value.actionStates, "state.actionStates");
  array(value.instantActionStates, "state.instantActionStates");
  object(value.powerSupply, "state.powerSupply");
  finite(value.powerSupply.stateOfCharge, "state.powerSupply.stateOfCharge", 0, 100);
  boolean(value.powerSupply.charging, "state.powerSupply.charging");
  if (!["STARTUP", "AUTOMATIC", "SEMIAUTOMATIC", "INTERVENED", "MANUAL", "SERVICE", "TEACH_IN"].includes(value.operatingMode)) {
    fail("state.operatingMode is invalid.");
  }
  array(value.errors, "state.errors");
  object(value.safetyState, "state.safetyState");
  if (!["MANUAL", "REMOTE", "NONE"].includes(value.safetyState.activeEmergencyStop)) fail("state.safetyState.activeEmergencyStop is invalid.");
  boolean(value.safetyState.fieldViolation, "state.safetyState.fieldViolation");
  object(value.mobileRobotPosition, "state.mobileRobotPosition");
  finite(value.mobileRobotPosition.x, "state.mobileRobotPosition.x");
  finite(value.mobileRobotPosition.y, "state.mobileRobotPosition.y");
  finite(value.mobileRobotPosition.theta, "state.mobileRobotPosition.theta");
  string(value.mobileRobotPosition.mapId, "state.mobileRobotPosition.mapId");
  boolean(value.mobileRobotPosition.localized, "state.mobileRobotPosition.localized");
  for (const action of [...value.actionStates, ...value.instantActionStates]) {
    string(action.actionId, "actionState.actionId");
    if (action.actionType !== undefined) string(action.actionType, "actionState.actionType");
    if (!["WAITING", "INITIALIZING", "RUNNING", "RETRIABLE", "PAUSED", "FINISHED", "FAILED"].includes(action.actionStatus)) fail("actionState.actionStatus is invalid.");
    if (action.actionResult !== undefined) string(action.actionResult, "actionState.actionResult", true);
  }
  for (const node of value.nodeStates) {
    string(node.nodeId, "nodeState.nodeId");
    integer(node.sequenceId, "nodeState.sequenceId");
    boolean(node.released, "nodeState.released");
  }
  for (const edge of value.edgeStates) {
    string(edge.edgeId, "edgeState.edgeId");
    integer(edge.sequenceId, "edgeState.sequenceId");
    boolean(edge.released, "edgeState.released");
  }
  for (const error of value.errors) {
    string(error.errorType, "error.errorType");
    if (!["WARNING", "URGENT", "CRITICAL", "FATAL"].includes(error.errorLevel)) fail("error.errorLevel is invalid.");
    if (error.errorReferences !== undefined) {
      array(error.errorReferences, "error.errorReferences");
      for (const reference of error.errorReferences) {
        string(reference.referenceKey, "errorReference.referenceKey");
        string(reference.referenceValue, "errorReference.referenceValue");
      }
    }
  }
  return value;
}

export function parseVda5050Connection(payload: string, expected?: Vda5050Identity): Vda5050Connection {
  const raw = parseObject(payload, "connection");
  const value = raw as unknown as Vda5050Connection;
  assertHeader(raw, "connection", expected);
  if (!["ONLINE", "OFFLINE", "HIBERNATING", "CONNECTION_BROKEN"].includes(value.connectionState)) fail("connection.connectionState is invalid.");
  return value;
}

export function parseVda5050Order(payload: string, expected?: Vda5050Identity): Vda5050Order {
  const raw = parseObject(payload, "order");
  const value = raw as unknown as Vda5050Order;
  assertHeader(raw, "order", expected);
  string(value.orderId, "order.orderId");
  integer(value.orderUpdateId, "order.orderUpdateId");
  array(value.nodes, "order.nodes");
  array(value.edges, "order.edges");
  if (value.nodes.length === 0) fail("order.nodes must not be empty.");
  for (const node of value.nodes) {
    string(node.nodeId, "node.nodeId");
    integer(node.sequenceId, "node.sequenceId");
    boolean(node.released, "node.released");
    validateActions(node.actions);
    if (node.nodePosition) {
      finite(node.nodePosition.x, "node.nodePosition.x");
      finite(node.nodePosition.y, "node.nodePosition.y");
      string(node.nodePosition.mapId, "node.nodePosition.mapId");
    }
  }
  for (const edge of value.edges) {
    string(edge.edgeId, "edge.edgeId");
    integer(edge.sequenceId, "edge.sequenceId");
    boolean(edge.released, "edge.released");
    validateActions(edge.actions);
  }
  return value;
}

export function parseVda5050InstantActions(payload: string, expected?: Vda5050Identity): Vda5050InstantActions {
  const raw = parseObject(payload, "instantActions");
  const value = raw as unknown as Vda5050InstantActions;
  assertHeader(raw, "instantActions", expected);
  validateActions(value.actions);
  if (value.actions.some((action) => action.blockingType !== "NONE")) {
    fail("instantActions blockingType must be NONE in VDA 5050 3.0.0.");
  }
  return value;
}

function assertHeader(value: Record<string, unknown>, kind: string, expected?: Vda5050Identity): void {
  integer(value.headerId, `${kind}.headerId`);
  string(value.timestamp, `${kind}.timestamp`);
  if (!Number.isFinite(Date.parse(value.timestamp as string))) fail(`${kind}.timestamp must be ISO-8601.`);
  if (value.version !== VDA5050_VERSION) fail(`${kind}.version must be ${VDA5050_VERSION}.`);
  string(value.manufacturer, `${kind}.manufacturer`);
  string(value.serialNumber, `${kind}.serialNumber`);
  if (expected && (value.manufacturer !== expected.manufacturer || value.serialNumber !== expected.serialNumber)) {
    fail(`${kind} identity does not match its MQTT topic.`);
  }
}

function validateActions(actions: Vda5050Action[]): void {
  array(actions, "actions");
  for (const action of actions) {
    string(action.actionId, "action.actionId");
    string(action.actionType, "action.actionType");
    if (!["NONE", "SOFT", "SINGLE", "HARD"].includes(action.blockingType)) fail("action.blockingType is invalid.");
    if (action.actionParameters !== undefined) array(action.actionParameters, "action.actionParameters");
  }
}

function parseObject(payload: string, kind: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    fail(`VDA 5050 ${kind} payload is not valid JSON.`);
  }
  object(value, kind);
  return value;
}

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
}

function array(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(`${name} must be an array.`);
}

function string(value: unknown, name: string, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) fail(`${name} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
}

function boolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean") fail(`${name} must be a boolean.`);
}

function integer(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${name} must be a non-negative safe integer.`);
}

function finite(value: unknown, name: string, minimum?: number, maximum?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be finite.`);
  if (minimum !== undefined && value < minimum) fail(`${name} must be at least ${minimum}.`);
  if (maximum !== undefined && value > maximum) fail(`${name} must be at most ${maximum}.`);
}

function fail(message: string): never {
  throw new Error(`Invalid VDA 5050 message: ${message}`);
}
