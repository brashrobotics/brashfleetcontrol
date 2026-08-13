import {
  FLEET_SCHEMA_VERSION,
  type CommandReceipt,
  type MissionCommand,
  type RobotAdapterEvent,
  type RobotConnection,
  type RobotDescriptor,
  type RobotStateSnapshot,
} from "@brash/contracts";
import type { MqttConnectionState, MqttMessage, MqttTransport } from "@brash/mqtt-adapter";
import {
  AdapterContractError,
  ROBOT_ADAPTER_SDK_VERSION,
  assertRobotDescriptor,
  type AdapterManifest,
  type RobotAdapter,
  type RobotAdapterEventHandler,
  type Unsubscribe,
} from "@brash/robot-adapter-sdk";
import { missionCommandToVda5050Order } from "./vda5050-mapper.js";
import { vda5050Topic, type Vda5050TopicOptions } from "./vda5050-topics.js";
import {
  VDA5050_VERSION,
  type Vda5050ConnectionState,
  type Vda5050Identity,
  type Vda5050State,
} from "./vda5050-types.js";
import { parseVda5050Connection, parseVda5050State } from "./vda5050-validation.js";

export interface Vda5050RobotConfig extends Vda5050Identity {
  descriptor: RobotDescriptor;
}

export interface Vda5050AdapterOptions extends Vda5050TopicOptions {
  transport: MqttTransport;
  robots: Vda5050RobotConfig[];
  adapterId?: string;
  displayName?: string;
  acknowledgementTimeoutMs?: number;
  initialStateTimeoutMs?: number;
  now?: () => Date;
  onBackgroundError?: (error: Error) => void;
}

interface CommandRecord {
  command: MissionCommand;
  fingerprint: string;
  receipt: CommandReceipt | null;
  cancellationReceipt: CommandReceipt | null;
  cancellationRequested: boolean;
}

interface PendingSignal<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface HeaderCursor {
  headerId: number;
  timestampMs: number;
}

export class Vda5050Adapter implements RobotAdapter {
  readonly adapterId: string;
  readonly manifest: AdapterManifest;

  private readonly transport: MqttTransport;
  private readonly robots = new Map<string, Vda5050RobotConfig>();
  private readonly robotByStateTopic = new Map<string, Vda5050RobotConfig>();
  private readonly robotByConnectionTopic = new Map<string, Vda5050RobotConfig>();
  private readonly handlers = new Set<RobotAdapterEventHandler>();
  private readonly states = new Map<string, RobotStateSnapshot>();
  private readonly vdaStates = new Map<string, Vda5050State>();
  private readonly connectionStates = new Map<string, Vda5050ConnectionState>();
  private readonly commands = new Map<string, CommandRecord>();
  private readonly orderAcknowledgements = new Map<string, PendingSignal<{ accepted: boolean; reason?: string }>>();
  private readonly cancellationAcknowledgements = new Map<string, PendingSignal<{ accepted: boolean; reason?: string }>>();
  private readonly stateWaiters = new Map<string, Set<PendingSignal<RobotStateSnapshot>>>();
  private readonly headerCursors = new Map<string, HeaderCursor>();
  private readonly outboundHeaders = new Map<string, number>();
  private readonly emittedMissionStatuses = new Set<string>();
  private readonly topicOptions: Vda5050TopicOptions;
  private readonly acknowledgementTimeoutMs: number;
  private readonly initialStateTimeoutMs: number;
  private readonly now: () => Date;
  private readonly onBackgroundError: (error: Error) => void;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private connected = false;
  private subscribing = false;

  constructor(options: Vda5050AdapterOptions) {
    this.adapterId = options.adapterId ?? "vda5050-v3";
    this.manifest = {
      sdkVersion: ROBOT_ADAPTER_SDK_VERSION,
      adapterId: this.adapterId,
      displayName: options.displayName ?? "BRASH VDA 5050 v3 adapter",
      adapterVersion: "1.0.0",
      protocol: "VDA5050",
      vendor: "BRASH",
      features: [
        "ROBOT_DISCOVERY",
        "STATE_POLLING",
        "STATE_EVENTS",
        "MISSION_EXECUTION",
        "MISSION_CANCELLATION",
        "IDEMPOTENT_COMMANDS",
      ],
      supportedFleetSchemaVersions: [FLEET_SCHEMA_VERSION],
    };
    this.transport = options.transport;
    this.topicOptions = { interfaceName: options.interfaceName, majorVersion: options.majorVersion };
    this.acknowledgementTimeoutMs = positiveInteger(options.acknowledgementTimeoutMs, 5_000, "acknowledgementTimeoutMs");
    this.initialStateTimeoutMs = positiveInteger(options.initialStateTimeoutMs, 10_000, "initialStateTimeoutMs");
    this.now = options.now ?? (() => new Date());
    this.onBackgroundError = options.onBackgroundError ?? (() => undefined);
    if (options.robots.length === 0) throw new Error("VDA 5050 adapter requires at least one configured robot.");

    for (const config of options.robots) {
      assertRobotDescriptor(config.descriptor);
      if (this.robots.has(config.descriptor.robotId)) throw new Error(`Duplicate VDA robotId ${config.descriptor.robotId}.`);
      const stateTopic = vda5050Topic(config, "state", this.topicOptions);
      const connectionTopic = vda5050Topic(config, "connection", this.topicOptions);
      if (this.robotByStateTopic.has(stateTopic)) throw new Error(`Duplicate VDA identity ${config.manufacturer}/${config.serialNumber}.`);
      this.robots.set(config.descriptor.robotId, structuredClone(config));
      this.robotByStateTopic.set(stateTopic, config);
      this.robotByConnectionTopic.set(connectionTopic, config);
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.unsubscribeMessage = this.transport.onMessage((message) => this.handleMessage(message));
    this.unsubscribeConnection = this.transport.onConnectionState((state) => this.handleTransportState(state));
    try {
      await this.transport.connect();
      this.connected = true;
      await this.subscribeToRobotTopics();
    } catch (error) {
      this.unsubscribeMessage?.();
      this.unsubscribeConnection?.();
      this.unsubscribeMessage = null;
      this.unsubscribeConnection = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected && !this.unsubscribeMessage) return;
    this.connected = false;
    this.rejectPending(new Error("VDA 5050 adapter disconnected."));
    this.unsubscribeMessage?.();
    this.unsubscribeConnection?.();
    this.unsubscribeMessage = null;
    this.unsubscribeConnection = null;
    await this.transport.disconnect();
  }

  async listRobots(): Promise<RobotDescriptor[]> {
    this.assertConnected();
    return [...this.robots.values()].map(({ descriptor }) => structuredClone(descriptor));
  }

  async getState(robotId: string): Promise<RobotStateSnapshot> {
    this.assertConnected();
    this.requireRobot(robotId);
    const state = this.states.get(robotId);
    if (state) return structuredClone(state);
    return this.waitForInitialState(robotId);
  }

  async executeMission(command: MissionCommand): Promise<CommandReceipt> {
    this.assertConnected();
    const robot = this.requireRobot(command.robotId);
    const fingerprint = stableJson(command);
    const previous = this.commands.get(command.commandId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new AdapterContractError("COMMAND_ID_REUSED", `Command ID ${command.commandId} was reused with different content.`);
      }
      if (previous.receipt) return structuredClone(previous.receipt);
    }

    const state = this.states.get(command.robotId) ?? await this.waitForInitialState(command.robotId);
    const record = previous ?? {
      command: structuredClone(command),
      fingerprint,
      receipt: null,
      cancellationReceipt: null,
      cancellationRequested: false,
    };
    this.commands.set(command.commandId, record);
    const remoteState = this.vdaStates.get(command.robotId);
    if (remoteState?.orderId === command.commandId && remoteState.orderUpdateId === 0) {
      record.receipt = this.receipt(command, "ACCEPTED");
      return structuredClone(record.receipt);
    }
    const reason = rejectionReason(command, state, this.now());
    if (reason) {
      record.receipt = this.receipt(command, "REJECTED", reason);
      return structuredClone(record.receipt);
    }

    const orderTopic = vda5050Topic(robot, "order", this.topicOptions);
    const order = missionCommandToVda5050Order(
      command,
      robot,
      this.nextOutboundHeader(orderTopic),
      state.pose,
    );
    const acknowledgement = this.createPending(
      this.orderAcknowledgements,
      command.commandId,
      this.acknowledgementTimeoutMs,
      `VDA robot ${command.robotId} did not acknowledge order ${command.commandId}`,
    );
    try {
      await this.transport.publish(orderTopic, JSON.stringify(order), { qos: 0, retain: false });
      const result = await acknowledgement;
      record.receipt = this.receipt(command, result.accepted ? "ACCEPTED" : "REJECTED", result.reason);
      return structuredClone(record.receipt);
    } catch (error) {
      this.clearPending(this.orderAcknowledgements, command.commandId);
      throw error;
    }
  }

  async cancelMission(robotId: string, commandId: string): Promise<CommandReceipt> {
    this.assertConnected();
    const robot = this.requireRobot(robotId);
    const record = this.commands.get(commandId);
    if (!record || record.command.robotId !== robotId) {
      return {
        schemaVersion: FLEET_SCHEMA_VERSION,
        commandId,
        missionId: record?.command.missionId ?? "unknown",
        robotId,
        status: "REJECTED",
        receivedAt: this.now().toISOString(),
        reason: "No matching VDA order is known by this adapter instance.",
      };
    }
    if (record.cancellationReceipt) return structuredClone(record.cancellationReceipt);
    record.cancellationRequested = true;
    const actionId = `cancel:${commandId}`;
    const topic = vda5050Topic(robot, "instantActions", this.topicOptions);
    const acknowledgement = this.createPending(
      this.cancellationAcknowledgements,
      actionId,
      this.acknowledgementTimeoutMs,
      `VDA robot ${robotId} did not acknowledge cancelOrder ${actionId}`,
    );
    const message = {
      headerId: this.nextOutboundHeader(topic),
      timestamp: this.now().toISOString(),
      version: VDA5050_VERSION,
      manufacturer: robot.manufacturer,
      serialNumber: robot.serialNumber,
      actions: [{
        actionType: "cancelOrder",
        actionId,
        blockingType: "NONE",
        actionDescriptor: `Cancel BRASH order ${commandId}`,
        actionParameters: [{ key: "orderId", value: commandId }],
      }],
    };
    try {
      await this.transport.publish(topic, JSON.stringify(message), { qos: 0, retain: false });
      const result = await acknowledgement;
      record.cancellationReceipt = this.receipt(
        record.command,
        result.accepted ? "ACCEPTED" : "REJECTED",
        result.reason,
      );
      if (!result.accepted) record.cancellationRequested = false;
      return structuredClone(record.cancellationReceipt);
    } catch (error) {
      this.clearPending(this.cancellationAcknowledgements, actionId);
      throw error;
    }
  }

  subscribe(handler: RobotAdapterEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private async subscribeToRobotTopics(): Promise<void> {
    if (this.subscribing || !this.transport.connected) return;
    this.subscribing = true;
    try {
      for (const robot of this.robots.values()) {
        await this.transport.subscribe({ topic: vda5050Topic(robot, "state", this.topicOptions), qos: 0 });
        await this.transport.subscribe({ topic: vda5050Topic(robot, "connection", this.topicOptions), qos: 1 });
      }
    } finally {
      this.subscribing = false;
    }
  }

  private async handleMessage(message: MqttMessage): Promise<void> {
    try {
      const stateRobot = this.robotByStateTopic.get(message.topic);
      if (stateRobot) return await this.handleState(stateRobot, message);
      const connectionRobot = this.robotByConnectionTopic.get(message.topic);
      if (connectionRobot) await this.handleConnection(connectionRobot, message);
    } catch (error) {
      this.onBackgroundError(asError(error));
    }
  }

  private async handleState(robot: Vda5050RobotConfig, message: MqttMessage): Promise<void> {
    const state = parseVda5050State(message.payload, robot);
    const pendingOrder = this.orderAcknowledgements.get(state.orderId);
    if (pendingOrder && state.orderUpdateId === 0) {
      this.clearPending(this.orderAcknowledgements, state.orderId);
      pendingOrder.resolve({ accepted: true });
    } else {
      for (const [orderId, pending] of this.orderAcknowledgements) {
        const rejection = state.errors.find((error) => error.errorReferences?.some((reference) =>
          reference.referenceKey === "orderId" && reference.referenceValue === orderId));
        if (!rejection) continue;
        this.clearPending(this.orderAcknowledgements, orderId);
        pending.resolve({ accepted: false, reason: rejection.errorDescription ?? rejection.errorType });
      }
    }
    this.resolveCancellationAcknowledgements(state);
    if (!this.acceptHeader(message.topic, state.headerId, state.timestamp)) return;

    const robotId = robot.descriptor.robotId;
    this.vdaStates.set(robotId, structuredClone(state));
    const previous = this.states.get(robotId);
    const connection = mapConnection(this.connectionStates.get(robotId) ?? "ONLINE");
    const command = this.commands.get(state.orderId);
    const missionStatus = command ? missionStatusFromState(state, command.cancellationRequested) : null;
    const activeOrder = command && missionStatus === null;
    const observedAt = state.timestamp;
    const canonical: RobotStateSnapshot = {
      schemaVersion: FLEET_SCHEMA_VERSION,
      robotId,
      sequence: (previous?.sequence ?? 0) + 1,
      observedAt,
      lastSeenAt: observedAt,
      connectionChangedAt: previous && previous.connection === connection ? previous.connectionChangedAt : observedAt,
      connection,
      availability: availabilityFromState(state, connection, Boolean(activeOrder)),
      batteryPercent: state.powerSupply.stateOfCharge,
      pose: {
        mapId: state.mobileRobotPosition.mapId,
        x: state.mobileRobotPosition.x,
        y: state.mobileRobotPosition.y,
        yaw: state.mobileRobotPosition.theta,
      },
      activeMissionId: activeOrder ? command.command.missionId : null,
    };
    this.states.set(robotId, canonical);
    this.resolveStateWaiters(robotId, canonical);
    if (command) {
      if (missionStatus) await this.emitMissionStatus(command, missionStatus.status, observedAt, missionStatus.reason);
      else if (state.driving || state.actionStates.some((action) => ["INITIALIZING", "RUNNING"].includes(action.actionStatus))) {
        await this.emitMissionStatus(command, "EXECUTING", observedAt);
      }
    }
    await this.emit({ type: "ROBOT_STATE", state: structuredClone(canonical) });
  }

  private async handleConnection(robot: Vda5050RobotConfig, message: MqttMessage): Promise<void> {
    const connection = parseVda5050Connection(message.payload, robot);
    // A broker publishes the preconfigured last will after the robot has
    // disconnected, so its headerId/timestamp can be older than the preceding
    // ONLINE message. Its delivery itself is the authoritative new event.
    if (connection.connectionState !== "CONNECTION_BROKEN"
      && !this.acceptHeader(message.topic, connection.headerId, connection.timestamp)) return;
    const robotId = robot.descriptor.robotId;
    this.connectionStates.set(robotId, connection.connectionState);
    const previous = this.states.get(robotId);
    if (!previous) return;
    const mapped = mapConnection(connection.connectionState);
    const canonical: RobotStateSnapshot = {
      ...previous,
      sequence: previous.sequence + 1,
      observedAt: connection.timestamp,
      lastSeenAt: connection.timestamp,
      connectionChangedAt: mapped === previous.connection ? previous.connectionChangedAt : connection.timestamp,
      connection: mapped,
    };
    this.states.set(robotId, canonical);
    await this.emit({ type: "ROBOT_STATE", state: structuredClone(canonical) });
  }

  private resolveCancellationAcknowledgements(state: Vda5050State): void {
    for (const action of state.instantActionStates) {
      const pending = this.cancellationAcknowledgements.get(action.actionId);
      if (!pending || !["FINISHED", "FAILED"].includes(action.actionStatus)) continue;
      this.clearPending(this.cancellationAcknowledgements, action.actionId);
      pending.resolve({
        accepted: action.actionStatus === "FINISHED",
        ...(action.actionStatus === "FAILED" ? { reason: errorForAction(state, action.actionId) ?? "VDA cancelOrder action failed." } : {}),
      });
    }
  }

  private handleTransportState(state: MqttConnectionState): void {
    if (state === "CONNECTED") {
      if (this.connected) void this.subscribeToRobotTopics().catch((error) => this.onBackgroundError(asError(error)));
      return;
    }
    if (!this.connected || !["OFFLINE", "RECONNECTING"].includes(state)) return;
    const observedAt = this.now().toISOString();
    for (const [robotId, previous] of this.states) {
      if (previous.connection === "DEGRADED") continue;
      const canonical: RobotStateSnapshot = {
        ...previous,
        sequence: previous.sequence + 1,
        observedAt,
        connectionChangedAt: observedAt,
        connection: "DEGRADED",
      };
      this.states.set(robotId, canonical);
      void this.emit({ type: "ROBOT_STATE", state: structuredClone(canonical) });
    }
  }

  private async emitMissionStatus(
    record: CommandRecord,
    status: "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED",
    observedAt: string,
    reason?: string,
  ): Promise<void> {
    const key = `${record.command.commandId}:${status}`;
    if (this.emittedMissionStatuses.has(key)) return;
    this.emittedMissionStatuses.add(key);
    await this.emit({
      type: "MISSION_STATUS",
      robotId: record.command.robotId,
      missionId: record.command.missionId,
      commandId: record.command.commandId,
      status,
      observedAt,
      ...(reason ? { reason } : {}),
    });
  }

  private async emit(event: RobotAdapterEvent): Promise<void> {
    for (const handler of [...this.handlers]) await handler(structuredClone(event));
  }

  private waitForInitialState(robotId: string): Promise<RobotStateSnapshot> {
    const waiters = this.stateWaiters.get(robotId) ?? new Set<PendingSignal<RobotStateSnapshot>>();
    this.stateWaiters.set(robotId, waiters);
    return new Promise((resolve, reject) => {
      const signal: PendingSignal<RobotStateSnapshot> = {
        resolve,
        reject,
        timer: setTimeout(() => {
          waiters.delete(signal);
          reject(new Error(`VDA robot ${robotId} did not publish state within ${this.initialStateTimeoutMs} ms.`));
        }, this.initialStateTimeoutMs),
      };
      waiters.add(signal);
    });
  }

  private resolveStateWaiters(robotId: string, state: RobotStateSnapshot): void {
    const waiters = this.stateWaiters.get(robotId);
    if (!waiters) return;
    this.stateWaiters.delete(robotId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(structuredClone(state));
    }
  }

  private createPending<T>(
    collection: Map<string, PendingSignal<T>>,
    key: string,
    timeoutMs: number,
    description: string,
  ): Promise<T> {
    this.clearPending(collection, key);
    return new Promise((resolve, reject) => {
      const signal: PendingSignal<T> = {
        resolve,
        reject,
        timer: setTimeout(() => {
          collection.delete(key);
          reject(new Error(`${description} within ${timeoutMs} ms.`));
        }, timeoutMs),
      };
      collection.set(key, signal);
    });
  }

  private clearPending<T>(collection: Map<string, PendingSignal<T>>, key: string): void {
    const pending = collection.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    collection.delete(key);
  }

  private rejectPending(error: Error): void {
    for (const collection of [this.orderAcknowledgements, this.cancellationAcknowledgements]) {
      for (const pending of collection.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      collection.clear();
    }
    for (const waiters of this.stateWaiters.values()) {
      for (const pending of waiters) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
    }
    this.stateWaiters.clear();
  }

  private acceptHeader(topic: string, headerId: number, timestamp: string): boolean {
    const timestampMs = Date.parse(timestamp);
    const previous = this.headerCursors.get(topic);
    if (previous && headerId <= previous.headerId && timestampMs <= previous.timestampMs) return false;
    this.headerCursors.set(topic, { headerId, timestampMs });
    return true;
  }

  private nextOutboundHeader(topic: string): number {
    const next = (this.outboundHeaders.get(topic) ?? -1) + 1;
    this.outboundHeaders.set(topic, next);
    return next;
  }

  private receipt(command: MissionCommand, status: "ACCEPTED" | "REJECTED", reason?: string): CommandReceipt {
    return {
      schemaVersion: FLEET_SCHEMA_VERSION,
      commandId: command.commandId,
      missionId: command.missionId,
      robotId: command.robotId,
      status,
      receivedAt: this.now().toISOString(),
      ...(reason ? { reason } : {}),
    };
  }

  private requireRobot(robotId: string): Vda5050RobotConfig {
    const robot = this.robots.get(robotId);
    if (!robot) throw new Error(`VDA robot ${robotId} is not configured.`);
    return robot;
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error("VDA 5050 adapter is not connected.");
  }
}

function mapConnection(state: Vda5050ConnectionState): RobotConnection {
  if (state === "ONLINE") return "ONLINE";
  if (state === "HIBERNATING") return "DEGRADED";
  return "OFFLINE";
}

function availabilityFromState(
  state: Vda5050State,
  connection: RobotConnection,
  activeOrder: boolean,
): RobotStateSnapshot["availability"] {
  if (connection === "OFFLINE") return "ERROR";
  if (state.operatingMode !== "AUTOMATIC" || state.safetyState.activeEmergencyStop !== "NONE") return "MANUAL";
  if (state.errors.some((error) => ["CRITICAL", "FATAL"].includes(error.errorLevel))) return "ERROR";
  if (state.powerSupply.charging) return "CHARGING";
  if (!activeOrder) return "AVAILABLE";
  if (state.driving || state.actionStates.some((action) => ["INITIALIZING", "RUNNING"].includes(action.actionStatus))) return "EXECUTING";
  return "RESERVED";
}

function missionStatusFromState(
  state: Vda5050State,
  cancellationRequested: boolean,
): { status: "COMPLETED" | "FAILED" | "CANCELLED"; reason?: string } | null {
  if (cancellationRequested && state.instantActionStates.some((action) =>
    action.actionId === `cancel:${state.orderId}` && action.actionStatus === "FINISHED")) {
    return { status: "CANCELLED" };
  }
  const failedAction = state.actionStates.find((action) => action.actionStatus === "FAILED");
  if (failedAction) return { status: "FAILED", reason: errorForAction(state, failedAction.actionId) ?? `VDA action ${failedAction.actionId} failed.` };
  const fatalError = state.errors.find((error) => ["CRITICAL", "FATAL"].includes(error.errorLevel));
  if (fatalError) return { status: "FAILED", reason: fatalError.errorDescription ?? fatalError.errorType };
  const orderFinished = state.nodeStates.length === 0
    && state.edgeStates.length === 0
    && state.actionStates.every((action) => action.actionStatus === "FINISHED");
  if (!orderFinished) return null;
  return { status: cancellationRequested ? "CANCELLED" : "COMPLETED" };
}

function errorForAction(state: Vda5050State, actionId: string): string | null {
  return state.errors.find((error) => error.errorReferences?.some((reference) =>
    reference.referenceKey === "actionId" && reference.referenceValue === actionId))?.errorDescription ?? null;
}

function rejectionReason(command: MissionCommand, state: RobotStateSnapshot, now: Date): string | null {
  if (state.connection !== "ONLINE") return `Robot connection is ${state.connection}.`;
  if (state.availability !== "AVAILABLE") return `Robot is ${state.availability}.`;
  if (state.pose.mapId !== command.mapId) return "Robot and mission map versions do not match.";
  if (Date.parse(command.expiresAt) <= now.getTime()) return "Command has expired.";
  return null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${name} must be a positive integer.`);
  return resolved;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
