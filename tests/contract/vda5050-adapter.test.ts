import assert from "node:assert/strict";
import test from "node:test";
import { FLEET_SCHEMA_VERSION, type MissionCommand, type RobotAdapterEvent } from "@brash/contracts";
import type {
  MqttConnectionHandler,
  MqttMessage,
  MqttMessageHandler,
  MqttPublishOptions,
  MqttSubscription,
  MqttTransport,
} from "@brash/mqtt-adapter";
import {
  Vda5050Adapter,
  missionCommandToVda5050Order,
  parseVda5050State,
  vda5050Topic,
  type Vda5050RobotConfig,
} from "@brash/vda5050-adapter";
import { createDefaultEmulatorRobots } from "../../apps/robot-simulator/src/fixtures/default-robots.js";
import { Vda5050RobotEmulator } from "../../apps/robot-simulator/src/vda5050/vda5050-robot-emulator.js";

test("canonical transport mission maps to a released VDA 5050 v3 base", () => {
  const command = mission("CMD-MAP", "MISSION-MAP");
  const order = missionCommandToVda5050Order(
    command,
    { manufacturer: "BRASH", serialNumber: "EMU-01" },
    7,
    { mapId: "plant-a@1", x: 5, y: 5, yaw: 0 },
  );
  assert.equal(order.version, "3.0.0");
  assert.equal(order.headerId, 7);
  assert.deepEqual(order.nodes.map((node) => node.sequenceId), [0, 2, 4]);
  assert.deepEqual(order.edges.map((edge) => edge.sequenceId), [1, 3]);
  assert.deepEqual(order.nodes[1].actions.map((action) => action.actionType), ["pick"]);
  assert.deepEqual(order.nodes[2].actions.map((action) => action.actionType), ["drop"]);
  assert.ok(order.nodes.every((node) => node.released));
  assert.ok(order.edges.every((edge) => edge.released));
});

test("supported VDA state validation enforces percentage stateOfCharge", () => {
  const payload = validState();
  assert.equal(parseVda5050State(JSON.stringify(payload)).powerSupply.stateOfCharge, 82);
  payload.powerSupply.stateOfCharge = 101;
  assert.throws(() => parseVda5050State(JSON.stringify(payload)), /at most 100/);
});

test("VDA adapter and independent MQTT robot emulator execute and cancel without duplicate physical work", async () => {
  const broker = new InMemoryMqttBroker();
  const definition = createDefaultEmulatorRobots()[0];
  const identity = { manufacturer: "BRASH", serialNumber: definition.descriptor.robotId };
  const emulator = new Vda5050RobotEmulator({
    robots: [{ ...identity, definition, transport: broker.createTransport("robot") }],
    startDelayMs: 5,
    missionDurationMs: 80,
    motionUpdateIntervalMs: 5,
    heartbeatIntervalMs: 10,
  });
  const adapterTransport = broker.createTransport("fleet");
  const adapter = new Vda5050Adapter({
    transport: adapterTransport,
    robots: [robotConfig(definition.descriptor)],
    acknowledgementTimeoutMs: 300,
    initialStateTimeoutMs: 300,
  });
  const events: RobotAdapterEvent[] = [];
  adapter.subscribe((event) => {
    events.push(structuredClone(event));
  });

  await emulator.start();
  await adapter.connect();
  try {
    const initial = await adapter.getState(definition.descriptor.robotId);
    assert.equal(initial.connection, "ONLINE");
    const firstCommand = mission("CMD-E2E", "MISSION-E2E");
    const first = await adapter.executeMission(firstCommand);
    const duplicate = await adapter.executeMission(structuredClone(firstCommand));
    assert.deepEqual(duplicate, first);
    assert.equal(first.status, "ACCEPTED");
    await waitFor(() => missionEvent(events, "CMD-E2E", "COMPLETED"), 1_000);
    assert.equal((await adapter.getState("EMU-01")).availability, "AVAILABLE");

    const orderTopic = vda5050Topic(identity, "order");
    const completedPhysicalRuns = events.filter((event) => event.type === "MISSION_STATUS"
      && event.commandId === "CMD-E2E" && event.status === "COMPLETED").length;
    const repeatedOrder = missionCommandToVda5050Order(firstCommand, identity, 99, definition.state.pose);
    await adapterTransport.publish(orderTopic, JSON.stringify(repeatedOrder), { qos: 0 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(events.filter((event) => event.type === "MISSION_STATUS"
      && event.commandId === "CMD-E2E" && event.status === "COMPLETED").length, completedPhysicalRuns);
    const latestRobotState = broker.publications.filter((message) => message.topic === vda5050Topic(identity, "state")).at(-1);
    assert.ok(latestRobotState);
    assert.equal(parseVda5050State(latestRobotState.payload).errors.some((error) => error.errorType === "orderError"), false);

    await adapter.disconnect();
    const orderPublicationCount = broker.publications.filter((message) => message.topic === orderTopic).length;
    const restarted = new Vda5050Adapter({
      transport: broker.createTransport("fleet-restarted"),
      robots: [robotConfig(definition.descriptor)],
      acknowledgementTimeoutMs: 300,
      initialStateTimeoutMs: 300,
    });
    await restarted.connect();
    try {
      await restarted.getState("EMU-01");
      assert.equal((await restarted.executeMission(structuredClone(firstCommand))).status, "ACCEPTED");
      assert.equal(broker.publications.filter((message) => message.topic === orderTopic).length, orderPublicationCount);
    } finally {
      await restarted.disconnect();
    }
    await adapter.connect();

    const cancelCommand = mission("CMD-CANCEL", "MISSION-CANCEL");
    assert.equal((await adapter.executeMission(cancelCommand)).status, "ACCEPTED");
    const cancellation = await adapter.cancelMission("EMU-01", "CMD-CANCEL");
    const cancellationReplay = await adapter.cancelMission("EMU-01", "CMD-CANCEL");
    assert.equal(cancellation.status, "ACCEPTED");
    assert.deepEqual(cancellationReplay, cancellation);
    await waitFor(() => missionEvent(events, "CMD-CANCEL", "CANCELLED"), 500);
    assert.equal((await adapter.getState("EMU-01")).activeMissionId, null);
  } finally {
    await adapter.disconnect();
    await emulator.stop();
  }
});

test("adapter marks broker interruption degraded and reconciles after reconnect", async () => {
  const broker = new InMemoryMqttBroker();
  const definition = createDefaultEmulatorRobots()[0];
  const robotTransport = broker.createTransport("robot");
  const fleetTransport = broker.createTransport("fleet");
  const emulator = new Vda5050RobotEmulator({
    robots: [{ manufacturer: "BRASH", serialNumber: "EMU-01", definition, transport: robotTransport }],
    heartbeatIntervalMs: 10,
  });
  const adapter = new Vda5050Adapter({
    transport: fleetTransport,
    robots: [robotConfig(definition.descriptor)],
    initialStateTimeoutMs: 300,
  });
  await emulator.start();
  await adapter.connect();
  try {
    await adapter.getState("EMU-01");
    const connectionTopic = vda5050Topic({ manufacturer: "BRASH", serialNumber: "EMU-01" }, "connection");
    await robotTransport.publish(connectionTopic, JSON.stringify({
      headerId: 0,
      timestamp: "2026-01-01T00:00:00.000Z",
      version: "3.0.0",
      manufacturer: "BRASH",
      serialNumber: "EMU-01",
      connectionState: "CONNECTION_BROKEN",
    }), { qos: 1, retain: true });
    await waitFor(async () => (await adapter.getState("EMU-01")).connection === "OFFLINE", 200);
    await robotTransport.publish(connectionTopic, JSON.stringify({
      headerId: 2,
      timestamp: new Date().toISOString(),
      version: "3.0.0",
      manufacturer: "BRASH",
      serialNumber: "EMU-01",
      connectionState: "ONLINE",
    }), { qos: 1, retain: true });
    await waitFor(async () => (await adapter.getState("EMU-01")).connection === "ONLINE", 200);
    fleetTransport.interrupt();
    await waitFor(async () => (await adapter.getState("EMU-01")).connection === "DEGRADED", 200);
    await fleetTransport.restore();
    await waitFor(async () => (await adapter.getState("EMU-01")).connection === "ONLINE", 500);
  } finally {
    await adapter.disconnect();
    await emulator.stop();
  }
});

class InMemoryMqttBroker {
  readonly publications: MqttMessage[] = [];
  private readonly transports = new Set<InMemoryMqttTransport>();
  private readonly retained = new Map<string, MqttMessage>();

  createTransport(clientId: string): InMemoryMqttTransport {
    const transport = new InMemoryMqttTransport(this, clientId);
    this.transports.add(transport);
    return transport;
  }

  async publish(source: InMemoryMqttTransport, topic: string, payload: string, options: MqttPublishOptions): Promise<void> {
    if (!source.connected) throw new Error("In-memory MQTT publisher is offline.");
    const message: MqttMessage = {
      topic,
      payload,
      qos: options.qos ?? 0,
      retained: options.retain ?? false,
    };
    this.publications.push(structuredClone(message));
    if (options.retain) this.retained.set(topic, structuredClone(message));
    await Promise.all([...this.transports]
      .filter((transport) => transport.connected && transport.subscriptions.has(topic))
      .map((transport) => transport.deliver(message)));
  }

  async retainedMessage(transport: InMemoryMqttTransport, topic: string): Promise<void> {
    const message = this.retained.get(topic);
    if (message) await transport.deliver({ ...structuredClone(message), retained: true });
  }
}

class InMemoryMqttTransport implements MqttTransport {
  readonly subscriptions = new Set<string>();
  private readonly messageHandlers = new Set<MqttMessageHandler>();
  private readonly connectionHandlers = new Set<MqttConnectionHandler>();
  connected = false;

  constructor(private readonly broker: InMemoryMqttBroker, readonly clientId: string) {}

  async connect(): Promise<void> {
    this.connected = true;
    this.emitConnection("CONNECTED");
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitConnection("DISCONNECTED");
  }

  async publish(topic: string, payload: string, options: MqttPublishOptions = {}): Promise<void> {
    await this.broker.publish(this, topic, payload, options);
  }

  async subscribe(subscription: MqttSubscription): Promise<void> {
    if (!this.connected) throw new Error("In-memory MQTT subscriber is offline.");
    this.subscriptions.add(subscription.topic);
    await this.broker.retainedMessage(this, subscription.topic);
  }

  onMessage(handler: MqttMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionState(handler: MqttConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  async deliver(message: MqttMessage): Promise<void> {
    for (const handler of this.messageHandlers) await handler(structuredClone(message));
  }

  interrupt(): void {
    this.connected = false;
    this.emitConnection("OFFLINE");
  }

  async restore(): Promise<void> {
    this.connected = true;
    this.emitConnection("CONNECTED");
    for (const topic of this.subscriptions) await this.broker.retainedMessage(this, topic);
  }

  private emitConnection(state: "CONNECTED" | "OFFLINE" | "DISCONNECTED"): void {
    for (const handler of this.connectionHandlers) handler(state);
  }
}

function robotConfig(descriptor: Vda5050RobotConfig["descriptor"]): Vda5050RobotConfig {
  return {
    manufacturer: "BRASH",
    serialNumber: descriptor.robotId,
    descriptor: {
      ...structuredClone(descriptor),
      model: "VDA5050-EMU-AMR",
      capabilities: { ...structuredClone(descriptor.capabilities), adapterProtocolVersion: "VDA5050/3.0.0" },
    },
  };
}

function mission(commandId: string, missionId: string): MissionCommand {
  const issuedAt = new Date();
  return {
    schemaVersion: FLEET_SCHEMA_VERSION,
    commandId,
    missionId,
    robotId: "EMU-01",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
    mapId: "plant-a@1",
    steps: [
      { type: "MOVE_TO", target: { stationId: "PICK-A", mapId: "plant-a@1", x: 10, y: 5 } },
      { type: "LOAD", stationId: "PICK-A", payloadKg: 25 },
      { type: "MOVE_TO", target: { stationId: "DROP-B", mapId: "plant-a@1", x: 20, y: 10 } },
      { type: "UNLOAD", stationId: "DROP-B" },
    ],
  };
}

function missionEvent(events: RobotAdapterEvent[], commandId: string, status: string): boolean {
  return events.some((event) => event.type === "MISSION_STATUS" && event.commandId === commandId && event.status === status);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Condition was not met within ${timeoutMs} ms.`);
}

function validState() {
  return {
    headerId: 1,
    timestamp: new Date().toISOString(),
    version: "3.0.0",
    manufacturer: "BRASH",
    serialNumber: "EMU-01",
    orderId: "",
    orderUpdateId: 0,
    lastNodeId: "",
    lastNodeSequenceId: 0,
    nodeStates: [],
    edgeStates: [],
    driving: false,
    actionStates: [],
    instantActionStates: [],
    powerSupply: { stateOfCharge: 82, charging: false },
    operatingMode: "AUTOMATIC",
    errors: [],
    safetyState: { activeEmergencyStop: "NONE", fieldViolation: false },
    mobileRobotPosition: { x: 5, y: 5, theta: 0, mapId: "plant-a@1", localized: true },
  };
}
