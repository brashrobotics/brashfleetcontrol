import { FLEET_SCHEMA_VERSION, type CommandReceipt, type MissionCommand, type RobotDescriptor, type RobotStateSnapshot } from "@brash/contracts";
import { assertAdapterEvent, assertRobotDescriptor, assertRobotState } from "./canonical-validation.js";
import { ROBOT_ADAPTER_SDK_VERSION, assertAdapterManifest, type AdapterManifest } from "./adapter-manifest.js";
import type { RobotAdapter, RobotAdapterEventHandler, Unsubscribe } from "./robot-adapter.js";

export class CompositeRobotAdapter implements RobotAdapter {
  readonly adapterId: string;
  readonly manifest: AdapterManifest;

  private readonly handlers = new Set<RobotAdapterEventHandler>();
  private readonly adapterByRobotId = new Map<string, RobotAdapter>();
  private upstreamUnsubscribers: Unsubscribe[] = [];
  private connected = false;

  constructor(private readonly adapters: RobotAdapter[], adapterId = "composite") {
    if (adapters.length === 0) throw new Error("Composite adapter requires at least one child adapter.");
    const childIds = new Set<string>();
    for (const adapter of adapters) {
      assertAdapterManifest(adapter.manifest);
      if (adapter.adapterId !== adapter.manifest.adapterId) throw new Error(`Adapter ${adapter.adapterId} manifest ID does not match.`);
      if (childIds.has(adapter.adapterId)) throw new Error(`Child adapter ID ${adapter.adapterId} is duplicated.`);
      childIds.add(adapter.adapterId);
    }
    this.adapterId = adapterId;
    this.manifest = {
      sdkVersion: ROBOT_ADAPTER_SDK_VERSION,
      adapterId,
      displayName: "Composite multi-vendor adapter",
      adapterVersion: "1.0.0",
      protocol: "COMPOSITE",
      features: ["ROBOT_DISCOVERY", "STATE_POLLING", "STATE_EVENTS", "MISSION_EXECUTION", "MISSION_CANCELLATION", "IDEMPOTENT_COMMANDS"],
      supportedFleetSchemaVersions: [FLEET_SCHEMA_VERSION],
    };
    assertAdapterManifest(this.manifest);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const connected: RobotAdapter[] = [];
    try {
      for (const adapter of this.adapters) {
        this.upstreamUnsubscribers.push(adapter.subscribe((event) => this.forward(event)));
        await adapter.connect();
        connected.push(adapter);
      }
      await this.refreshInventory();
      this.connected = true;
    } catch (error) {
      this.upstreamUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
      await Promise.allSettled(connected.map((adapter) => adapter.disconnect()));
      this.adapterByRobotId.clear();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected && this.upstreamUnsubscribers.length === 0) return;
    this.connected = false;
    this.adapterByRobotId.clear();
    this.upstreamUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    const results = await Promise.allSettled(this.adapters.map((adapter) => adapter.disconnect()));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), "One or more child adapters failed to disconnect.");
  }

  async listRobots(): Promise<RobotDescriptor[]> {
    this.assertConnected();
    return this.refreshInventory();
  }

  async getState(robotId: string): Promise<RobotStateSnapshot> {
    this.assertConnected();
    const state = await this.requireAdapter(robotId).getState(robotId);
    assertRobotState(state, robotId);
    return state;
  }

  async executeMission(command: MissionCommand): Promise<CommandReceipt> {
    this.assertConnected();
    return this.requireAdapter(command.robotId).executeMission(command);
  }

  async cancelMission(robotId: string, commandId: string): Promise<CommandReceipt> {
    this.assertConnected();
    return this.requireAdapter(robotId).cancelMission(robotId, commandId);
  }

  subscribe(handler: RobotAdapterEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private async refreshInventory(): Promise<RobotDescriptor[]> {
    const inventories = await Promise.all(this.adapters.map(async (adapter) => ({ adapter, descriptors: await adapter.listRobots() })));
    const nextRoutes = new Map<string, RobotAdapter>();
    const descriptors: RobotDescriptor[] = [];
    for (const inventory of inventories) {
      for (const descriptor of inventory.descriptors) {
        assertRobotDescriptor(descriptor);
        const owner = nextRoutes.get(descriptor.robotId);
        if (owner) throw new Error(`Robot ${descriptor.robotId} is declared by both ${owner.adapterId} and ${inventory.adapter.adapterId}.`);
        nextRoutes.set(descriptor.robotId, inventory.adapter);
        descriptors.push(structuredClone(descriptor));
      }
    }
    this.adapterByRobotId.clear();
    for (const [robotId, adapter] of nextRoutes) this.adapterByRobotId.set(robotId, adapter);
    return descriptors.sort((left, right) => left.robotId.localeCompare(right.robotId));
  }

  private requireAdapter(robotId: string): RobotAdapter {
    const adapter = this.adapterByRobotId.get(robotId);
    if (!adapter) throw new Error(`No child adapter owns robot ${robotId}. Refresh adapter inventory before dispatch.`);
    return adapter;
  }

  private async forward(event: Parameters<RobotAdapterEventHandler>[0]): Promise<void> {
    assertAdapterEvent(event);
    await Promise.all([...this.handlers].map((handler) => handler(structuredClone(event))));
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error("Composite adapter is not connected.");
  }
}

