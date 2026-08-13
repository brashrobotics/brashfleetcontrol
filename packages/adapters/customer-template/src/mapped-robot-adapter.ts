import type { CommandReceipt, MissionCommand, RobotAdapterEvent, RobotDescriptor, RobotStateSnapshot } from "@brash/contracts";
import {
  AdapterContractError,
  assertAdapterEvent,
  assertAdapterManifest,
  assertCommandReceipt,
  assertRobotDescriptor,
  assertRobotState,
  type AdapterManifest,
  type RobotAdapter,
  type RobotAdapterEventHandler,
  type Unsubscribe,
} from "@brash/robot-adapter-sdk";

export interface VendorCommandContext {
  robotId: string;
  commandId: string;
  missionId: string;
  idempotencyKey: string;
}

export interface VendorRobotDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listRobots(): Promise<unknown[]>;
  getState(robotId: string): Promise<unknown>;
  executeMission(payload: unknown, context: VendorCommandContext): Promise<unknown>;
  cancelMission(payload: unknown, context: VendorCommandContext): Promise<unknown>;
  resolveMissionId?(robotId: string, commandId: string): Promise<string | null>;
  subscribe(handler: (event: unknown) => void | Promise<void>): Unsubscribe;
}

export interface VendorProtocolMapper {
  toDescriptor(payload: unknown): RobotDescriptor;
  toState(payload: unknown): RobotStateSnapshot;
  fromMissionCommand(command: MissionCommand): unknown;
  fromCancellation(robotId: string, commandId: string): unknown;
  toCommandReceipt(payload: unknown, expected: VendorCommandContext): CommandReceipt;
  toAdapterEvent(payload: unknown): RobotAdapterEvent | null;
}

interface CachedReceipt {
  fingerprint: string;
  receipt: CommandReceipt;
}

export class MappedRobotAdapter implements RobotAdapter {
  readonly adapterId: string;
  readonly manifest: AdapterManifest;

  private readonly handlers = new Set<RobotAdapterEventHandler>();
  private readonly commandReceipts = new Map<string, CachedReceipt>();
  private readonly cancellationReceipts = new Map<string, CommandReceipt>();
  private unsubscribeDriver: Unsubscribe | null = null;
  private connected = false;

  constructor(
    manifest: AdapterManifest,
    private readonly driver: VendorRobotDriver,
    private readonly mapper: VendorProtocolMapper,
  ) {
    assertAdapterManifest(manifest);
    if (manifest.protocol === "COMPOSITE") throw new Error("A customer protocol adapter cannot declare COMPOSITE protocol.");
    this.manifest = structuredClone(manifest);
    this.adapterId = manifest.adapterId;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.unsubscribeDriver = this.driver.subscribe((event) => this.handleVendorEvent(event));
    try {
      await this.driver.connect();
      this.connected = true;
    } catch (error) {
      this.unsubscribeDriver?.();
      this.unsubscribeDriver = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected && !this.unsubscribeDriver) return;
    this.connected = false;
    this.unsubscribeDriver?.();
    this.unsubscribeDriver = null;
    await this.driver.disconnect();
  }

  async listRobots(): Promise<RobotDescriptor[]> {
    this.assertConnected();
    const descriptors = (await this.driver.listRobots()).map((payload) => this.mapper.toDescriptor(payload));
    const robotIds = new Set<string>();
    for (const descriptor of descriptors) {
      assertRobotDescriptor(descriptor);
      if (robotIds.has(descriptor.robotId)) throw new AdapterContractError("INVENTORY_ROBOT_DUPLICATE", `Vendor returned robot ${descriptor.robotId} twice.`);
      robotIds.add(descriptor.robotId);
    }
    return structuredClone(descriptors);
  }

  async getState(robotId: string): Promise<RobotStateSnapshot> {
    this.assertConnected();
    const state = this.mapper.toState(await this.driver.getState(robotId));
    assertRobotState(state, robotId);
    return structuredClone(state);
  }

  async executeMission(command: MissionCommand): Promise<CommandReceipt> {
    this.assertConnected();
    const fingerprint = JSON.stringify(command);
    const duplicate = this.commandReceipts.get(command.commandId);
    if (duplicate) {
      if (duplicate.fingerprint !== fingerprint) throw new AdapterContractError("COMMAND_ID_REUSED", `Command ID ${command.commandId} was reused with different content.`);
      return structuredClone(duplicate.receipt);
    }
    const context = commandContext(command.robotId, command.commandId, command.missionId);
    const raw = await this.driver.executeMission(this.mapper.fromMissionCommand(command), context);
    const receipt = this.mapper.toCommandReceipt(raw, context);
    assertCommandReceipt(receipt, context);
    this.commandReceipts.set(command.commandId, { fingerprint, receipt: structuredClone(receipt) });
    return structuredClone(receipt);
  }

  async cancelMission(robotId: string, commandId: string): Promise<CommandReceipt> {
    this.assertConnected();
    const command = this.commandReceipts.get(commandId)?.receipt;
    if (command && command.robotId !== robotId) throw new AdapterContractError("CANCELLATION_ROBOT_MISMATCH", `Command ${commandId} belongs to ${command.robotId}, not ${robotId}.`);
    const missionId = command?.missionId ?? await this.driver.resolveMissionId?.(robotId, commandId);
    if (!missionId) throw new AdapterContractError("CANCELLATION_COMMAND_UNKNOWN", `Command ${commandId} cannot be correlated after restart. Persist the command ledger or implement driver.resolveMissionId().`);
    const key = `${robotId}:${commandId}`;
    const duplicate = this.cancellationReceipts.get(key);
    if (duplicate) return structuredClone(duplicate);
    const context = commandContext(robotId, commandId, missionId);
    const raw = await this.driver.cancelMission(this.mapper.fromCancellation(robotId, commandId), context);
    const receipt = this.mapper.toCommandReceipt(raw, context);
    assertCommandReceipt(receipt, context);
    this.cancellationReceipts.set(key, structuredClone(receipt));
    return structuredClone(receipt);
  }

  subscribe(handler: RobotAdapterEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private async handleVendorEvent(payload: unknown): Promise<void> {
    const event = this.mapper.toAdapterEvent(payload);
    if (!event) return;
    assertAdapterEvent(event);
    await Promise.all([...this.handlers].map((handler) => handler(structuredClone(event))));
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error(`Adapter ${this.adapterId} is not connected.`);
  }
}

function commandContext(robotId: string, commandId: string, missionId: string): VendorCommandContext {
  return { robotId, commandId, missionId, idempotencyKey: commandId };
}
