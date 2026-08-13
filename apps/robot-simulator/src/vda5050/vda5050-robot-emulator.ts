import {
  FLEET_SCHEMA_VERSION,
  type MissionCommand,
  type RobotAdapterEvent,
  type RobotStateSnapshot,
} from "@brash/contracts";
import type { MqttMessage, MqttTransport } from "@brash/mqtt-adapter";
import type { SimulatorRobotDefinition } from "@brash/simulator-adapter";
import {
  VDA5050_VERSION,
  parseVda5050InstantActions,
  parseVda5050Order,
  vda5050Topic,
  type Vda5050ActionState,
  type Vda5050Connection,
  type Vda5050Error,
  type Vda5050Identity,
  type Vda5050Order,
  type Vda5050State,
  type Vda5050TopicOptions,
} from "@brash/vda5050-adapter";
import { RobotEmulatorEngine, type RobotEmulatorEngineOptions } from "../engine/robot-emulator-engine.js";

export interface Vda5050EmulatedRobot extends Vda5050Identity {
  definition: SimulatorRobotDefinition;
  transport: MqttTransport;
}

export interface Vda5050RobotEmulatorOptions extends Vda5050TopicOptions, RobotEmulatorEngineOptions {
  robots: Vda5050EmulatedRobot[];
  now?: () => Date;
  onError?: (error: Error) => void;
}

type EmulatedOrderStatus = "RESERVED" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED";

interface EmulatedOrder {
  order: Vda5050Order;
  command: MissionCommand;
  fingerprint: string;
  status: EmulatedOrderStatus;
  failureReason?: string;
}

interface RobotRuntime extends Vda5050EmulatedRobot {
  unsubscribeMessage: (() => void) | null;
  activeOrder: EmulatedOrder | null;
  seenOrders: Map<string, string>;
  instantActionStates: Vda5050ActionState[];
  instantActionErrors: Vda5050Error[];
  stateHeaderId: number;
  connectionHeaderId: number;
  publishChain: Promise<void>;
}

export class Vda5050RobotEmulator {
  readonly engine: RobotEmulatorEngine;

  private readonly runtimes = new Map<string, RobotRuntime>();
  private readonly topicOptions: Vda5050TopicOptions;
  private readonly now: () => Date;
  private readonly onError: (error: Error) => void;
  private started = false;

  constructor(options: Vda5050RobotEmulatorOptions) {
    if (options.robots.length === 0) throw new Error("VDA emulator requires at least one robot.");
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError ?? (() => undefined);
    this.topicOptions = { interfaceName: options.interfaceName, majorVersion: options.majorVersion };
    for (const robot of options.robots) {
      const robotId = robot.definition.descriptor.robotId;
      if (this.runtimes.has(robotId)) throw new Error(`Duplicate VDA emulator robot ${robotId}.`);
      this.runtimes.set(robotId, {
        ...robot,
        unsubscribeMessage: null,
        activeOrder: null,
        seenOrders: new Map(),
        instantActionStates: [],
        instantActionErrors: [],
        stateHeaderId: 0,
        connectionHeaderId: 1,
        publishChain: Promise.resolve(),
      });
    }
    this.engine = new RobotEmulatorEngine(
      options.robots.map((robot) => robot.definition),
      {
        ...options,
        now: this.now,
        onEvent: (event) => this.handleEngineEvent(event),
        onError: this.onError,
      },
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.engine.start();
    try {
      for (const runtime of this.runtimes.values()) {
        runtime.unsubscribeMessage = runtime.transport.onMessage((message) => this.handleMessage(runtime, message));
        await runtime.transport.connect();
        await runtime.transport.subscribe({ topic: vda5050Topic(runtime, "order", this.topicOptions), qos: 0 });
        await runtime.transport.subscribe({ topic: vda5050Topic(runtime, "instantActions", this.topicOptions), qos: 0 });
        await this.publishConnection(runtime, "ONLINE");
        await this.publishState(runtime);
      }
      this.started = true;
    } catch (error) {
      await this.stopRuntimes(false);
      await this.engine.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.stopRuntimes(true);
    await this.engine.stop();
  }

  private async stopRuntimes(graceful: boolean): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      if (graceful && runtime.transport.connected) {
        await this.publishConnection(runtime, "OFFLINE").catch((error) => this.onError(asError(error)));
      }
      runtime.unsubscribeMessage?.();
      runtime.unsubscribeMessage = null;
      await runtime.transport.disconnect().catch((error) => this.onError(asError(error)));
    }
  }

  private async handleMessage(runtime: RobotRuntime, message: MqttMessage): Promise<void> {
    try {
      const orderTopic = vda5050Topic(runtime, "order", this.topicOptions);
      if (message.topic === orderTopic) {
        await this.handleOrder(runtime, parseVda5050Order(message.payload, runtime));
        return;
      }
      const actionsTopic = vda5050Topic(runtime, "instantActions", this.topicOptions);
      if (message.topic === actionsTopic) {
        const actions = parseVda5050InstantActions(message.payload, runtime);
        for (const action of actions.actions) await this.handleInstantAction(runtime, action);
      }
    } catch (error) {
      this.onError(asError(error));
    }
  }

  private async handleOrder(runtime: RobotRuntime, order: Vda5050Order): Promise<void> {
    const fingerprint = orderFingerprint(order);
    const previousFingerprint = runtime.seenOrders.get(order.orderId);
    if (previousFingerprint) {
      if (previousFingerprint !== fingerprint) {
        await this.rejectOrder(runtime, order, "orderId/orderUpdateId was reused with different content.");
      } else {
        await this.publishState(runtime);
      }
      return;
    }
    const command = await orderToMissionCommand(runtime, order, this.now());
    const active: EmulatedOrder = { order: structuredClone(order), command, fingerprint, status: "RESERVED" };
    runtime.seenOrders.set(order.orderId, fingerprint);
    runtime.activeOrder = active;
    const receipt = await this.engine.executeMission(command);
    if (receipt.status === "REJECTED") {
      active.status = "FAILED";
      active.failureReason = receipt.reason ?? "Emulator rejected the order.";
    }
    await this.publishState(runtime);
  }

  private async rejectOrder(runtime: RobotRuntime, order: Vda5050Order, reason: string): Promise<void> {
    const state = await this.engine.getState(runtime.definition.descriptor.robotId);
    const message = this.toVdaState(runtime, state);
    message.errors.push({
      errorType: "orderError",
      errorLevel: "WARNING",
      errorDescription: reason,
      errorReferences: [{ referenceKey: "orderId", referenceValue: order.orderId }],
    });
    await this.publishStatePayload(runtime, message);
  }

  private async handleInstantAction(runtime: RobotRuntime, action: Vda5050Order["nodes"][number]["actions"][number]): Promise<void> {
    const actionState: Vda5050ActionState = {
      actionId: action.actionId,
      actionType: action.actionType,
      actionStatus: "RUNNING",
    };
    runtime.instantActionStates = runtime.instantActionStates.filter((state) => state.actionId !== action.actionId);
    runtime.instantActionStates.push(actionState);
    await this.publishState(runtime);

    if (action.actionType !== "cancelOrder") {
      actionState.actionStatus = "FAILED";
      this.recordInstantActionError(runtime, action.actionId, `Unsupported instant action ${action.actionType}.`);
      await this.publishState(runtime);
      return;
    }
    const requestedOrderId = parameterValue(action.actionParameters, "orderId");
    const active = runtime.activeOrder;
    if (!active || (requestedOrderId !== undefined && requestedOrderId !== active.order.orderId)) {
      actionState.actionStatus = "FAILED";
      this.recordInstantActionError(runtime, action.actionId, "No matching active order exists.");
      await this.publishState(runtime);
      return;
    }
    const receipt = await this.engine.cancelMission(active.command.robotId, active.command.commandId);
    if (receipt.status === "ACCEPTED") {
      active.status = "CANCELLED";
      actionState.actionStatus = "FINISHED";
    } else {
      actionState.actionStatus = "FAILED";
      this.recordInstantActionError(runtime, action.actionId, receipt.reason ?? "cancelOrder was rejected.");
    }
    await this.publishState(runtime);
  }

  private async handleEngineEvent(event: RobotAdapterEvent): Promise<void> {
    const robotId = event.type === "ROBOT_STATE" ? event.state.robotId : event.robotId;
    const runtime = this.runtimes.get(robotId);
    if (!runtime || !runtime.transport.connected) return;
    const active = runtime.activeOrder;
    if (event.type === "MISSION_STATUS" && active?.command.commandId === event.commandId) {
      active.status = event.status === "EXECUTING" ? "EXECUTING" : event.status;
      if (event.status === "FAILED") active.failureReason = event.reason ?? "Emulated mission failed.";
    }
    await this.publishState(runtime);
  }

  private publishState(runtime: RobotRuntime): Promise<void> {
    runtime.publishChain = runtime.publishChain
      .then(async () => {
        const state = await this.engine.getState(runtime.definition.descriptor.robotId);
        await this.publishStatePayload(runtime, this.toVdaState(runtime, state));
      })
      .catch((error) => this.onError(asError(error)));
    return runtime.publishChain;
  }

  private async publishStatePayload(runtime: RobotRuntime, state: Vda5050State): Promise<void> {
    await runtime.transport.publish(
      vda5050Topic(runtime, "state", this.topicOptions),
      JSON.stringify(state),
      { qos: 0, retain: false },
    );
  }

  private toVdaState(runtime: RobotRuntime, state: RobotStateSnapshot): Vda5050State {
    const active = runtime.activeOrder;
    const order = active?.order;
    const activeStatus = active?.status;
    const pending = active && ["RESERVED", "EXECUTING"].includes(activeStatus!);
    const failed = activeStatus === "FAILED";
    const actions = order ? order.nodes.flatMap((node) => node.actions) : [];
    const lastNode = order?.nodes.at(-1);
    return {
      headerId: runtime.stateHeaderId++,
      timestamp: this.now().toISOString(),
      version: VDA5050_VERSION,
      manufacturer: runtime.manufacturer,
      serialNumber: runtime.serialNumber,
      orderId: order?.orderId ?? "",
      orderUpdateId: order?.orderUpdateId ?? 0,
      lastNodeId: pending ? (order?.nodes[0]?.nodeId ?? "") : (lastNode?.nodeId ?? ""),
      lastNodeSequenceId: pending ? (order?.nodes[0]?.sequenceId ?? 0) : (lastNode?.sequenceId ?? 0),
      nodeStates: pending ? order!.nodes.slice(1).map((node) => ({
        nodeId: node.nodeId,
        sequenceId: node.sequenceId,
        released: node.released,
        ...(node.nodePosition ? { nodePosition: node.nodePosition } : {}),
      })) : [],
      edgeStates: pending ? order!.edges.map((edge) => ({
        edgeId: edge.edgeId,
        sequenceId: edge.sequenceId,
        released: edge.released,
      })) : [],
      driving: activeStatus === "EXECUTING",
      actionStates: actions.map((action) => ({
        actionId: action.actionId,
        actionType: action.actionType,
        actionStatus: failed ? "FAILED" : activeStatus === "COMPLETED" || activeStatus === "CANCELLED"
          ? "FINISHED"
          : activeStatus === "EXECUTING" ? "RUNNING" : "WAITING",
      })),
      instantActionStates: structuredClone(runtime.instantActionStates),
      powerSupply: { stateOfCharge: state.batteryPercent, charging: state.availability === "CHARGING" },
      operatingMode: state.availability === "MANUAL" ? "MANUAL" : "AUTOMATIC",
      errors: [...(failed ? [{
        errorType: "orderExecutionError",
        errorLevel: "CRITICAL" as const,
        errorDescription: active?.failureReason ?? "Emulated order failed.",
        errorReferences: [{ referenceKey: "orderId", referenceValue: order!.orderId }],
      }] : []), ...structuredClone(runtime.instantActionErrors)],
      safetyState: { activeEmergencyStop: "NONE", fieldViolation: false },
      mobileRobotPosition: {
        x: state.pose.x,
        y: state.pose.y,
        theta: state.pose.yaw,
        mapId: state.pose.mapId,
        localized: true,
      },
    };
  }

  private async publishConnection(runtime: RobotRuntime, state: Vda5050Connection["connectionState"]): Promise<void> {
    const connection: Vda5050Connection = {
      headerId: runtime.connectionHeaderId++,
      timestamp: this.now().toISOString(),
      version: VDA5050_VERSION,
      manufacturer: runtime.manufacturer,
      serialNumber: runtime.serialNumber,
      connectionState: state,
    };
    await runtime.transport.publish(
      vda5050Topic(runtime, "connection", this.topicOptions),
      JSON.stringify(connection),
      { qos: 1, retain: true },
    );
  }

  private recordInstantActionError(runtime: RobotRuntime, actionId: string, description: string): void {
    runtime.instantActionErrors = runtime.instantActionErrors.filter((error) =>
      !error.errorReferences?.some((reference) => reference.referenceKey === "actionId" && reference.referenceValue === actionId));
    runtime.instantActionErrors.push({
      errorType: "instantActionError",
      errorLevel: "WARNING",
      errorDescription: description,
      errorReferences: [{ referenceKey: "actionId", referenceValue: actionId }],
    });
  }
}

export function vda5050BrokenConnectionMessage(
  identity: Vda5050Identity,
  now = new Date(),
  headerId = 0,
): Vda5050Connection {
  return {
    headerId,
    timestamp: now.toISOString(),
    version: VDA5050_VERSION,
    ...identity,
    connectionState: "CONNECTION_BROKEN",
  };
}

async function orderToMissionCommand(runtime: RobotRuntime, order: Vda5050Order, now: Date): Promise<MissionCommand> {
  const state = await runtime.definition.state;
  const steps: MissionCommand["steps"] = [];
  for (const node of order.nodes.slice(1)) {
    if (!node.nodePosition) throw new Error(`Reference emulator requires nodePosition for ${node.nodeId}.`);
    steps.push({
      type: "MOVE_TO",
      target: {
        stationId: stationIdFromNode(node.nodeId),
        mapId: node.nodePosition.mapId,
        x: node.nodePosition.x,
        y: node.nodePosition.y,
      },
    });
    for (const action of node.actions) {
      const stationId = String(parameterValue(action.actionParameters, "stationId") ?? stationIdFromNode(node.nodeId));
      if (action.actionType === "pick") {
        const payloadKg = Number(parameterValue(action.actionParameters, "payloadKg") ?? 0);
        steps.push({ type: "LOAD", stationId, payloadKg });
      } else if (action.actionType === "drop") {
        steps.push({ type: "UNLOAD", stationId });
      }
    }
  }
  return {
    schemaVersion: FLEET_SCHEMA_VERSION,
    commandId: order.orderId,
    missionId: order.orderId,
    robotId: runtime.definition.descriptor.robotId,
    issuedAt: order.timestamp,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
    mapId: state.pose.mapId,
    steps,
  };
}

function parameterValue(parameters: Vda5050Order["nodes"][number]["actions"][number]["actionParameters"], key: string): unknown {
  return parameters?.find((parameter) => parameter.key === key)?.value;
}

function stationIdFromNode(nodeId: string): string {
  const separator = nodeId.lastIndexOf(":");
  return separator > 0 ? nodeId.slice(0, separator) : nodeId;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function orderFingerprint(order: Vda5050Order): string {
  const { headerId: _headerId, timestamp: _timestamp, ...logicalOrder } = order;
  return stableJson(logicalOrder);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
