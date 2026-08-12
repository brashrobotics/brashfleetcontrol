import {
  FLEET_SCHEMA_VERSION,
  type CommandReceipt,
  type MissionCommand,
  type RobotAdapterEvent,
  type RobotDescriptor,
  type RobotStateSnapshot,
} from "@brash/contracts";
import type {
  RobotAdapter,
  RobotAdapterEventHandler,
  Unsubscribe,
} from "@brash/robot-adapter-sdk";

export interface SimulatorRobotDefinition {
  descriptor: RobotDescriptor;
  state: RobotStateSnapshot;
}

export interface SimulatorAdapterOptions {
  now?: () => Date;
  autoAdvance?: boolean;
  startDelayMs?: number;
  completionDelayMs?: number;
}

interface ActiveCommand {
  command: MissionCommand;
  receipt: CommandReceipt;
}

export class SimulatorAdapter implements RobotAdapter {
  readonly adapterId = "simulator";

  private readonly descriptors = new Map<string, RobotDescriptor>();
  private readonly states = new Map<string, RobotStateSnapshot>();
  private readonly handlers = new Set<RobotAdapterEventHandler>();
  private readonly commands = new Map<string, ActiveCommand>();
  private readonly now: () => Date;
  private readonly autoAdvance: boolean;
  private readonly startDelayMs: number;
  private readonly completionDelayMs: number;
  private connected = false;

  constructor(definitions: SimulatorRobotDefinition[], options: SimulatorAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.autoAdvance = options.autoAdvance ?? false;
    this.startDelayMs = options.startDelayMs ?? 50;
    this.completionDelayMs = options.completionDelayMs ?? 1_000;

    for (const definition of definitions) {
      if (definition.descriptor.robotId !== definition.state.robotId) {
        throw new Error("Simulator robot descriptor and state IDs must match.");
      }
      this.descriptors.set(definition.descriptor.robotId, structuredClone(definition.descriptor));
      this.states.set(definition.state.robotId, structuredClone(definition.state));
    }
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async listRobots(): Promise<RobotDescriptor[]> {
    this.assertConnected();
    return [...this.descriptors.values()].map((descriptor) => structuredClone(descriptor));
  }

  async getState(robotId: string): Promise<RobotStateSnapshot> {
    this.assertConnected();
    const state = this.states.get(robotId);
    if (!state) throw new Error(`Simulator robot ${robotId} was not found.`);
    return structuredClone(state);
  }

  async executeMission(command: MissionCommand): Promise<CommandReceipt> {
    this.assertConnected();
    const duplicate = this.commands.get(command.commandId);
    if (duplicate) return structuredClone(duplicate.receipt);

    const state = this.states.get(command.robotId);
    const descriptor = this.descriptors.get(command.robotId);
    if (!state || !descriptor) throw new Error(`Simulator robot ${command.robotId} was not found.`);

    const rejection = this.rejectionReason(command, state, descriptor);
    const receipt: CommandReceipt = {
      schemaVersion: FLEET_SCHEMA_VERSION,
      commandId: command.commandId,
      missionId: command.missionId,
      robotId: command.robotId,
      status: rejection ? "REJECTED" : "ACCEPTED",
      receivedAt: this.now().toISOString(),
      ...(rejection ? { reason: rejection } : {}),
    };
    this.commands.set(command.commandId, { command: structuredClone(command), receipt });

    if (!rejection) {
      this.states.set(command.robotId, {
        ...state,
        sequence: state.sequence + 1,
        observedAt: this.now().toISOString(),
        availability: "RESERVED",
        activeMissionId: command.missionId,
      });
      if (this.autoAdvance) this.scheduleAutoAdvance(command.commandId);
    }

    return structuredClone(receipt);
  }

  async cancelMission(robotId: string, commandId: string): Promise<CommandReceipt> {
    this.assertConnected();
    const active = this.commands.get(commandId);
    if (!active || active.command.robotId !== robotId) {
      return {
        schemaVersion: FLEET_SCHEMA_VERSION,
        commandId,
        missionId: active?.command.missionId ?? "unknown",
        robotId,
        status: "REJECTED",
        receivedAt: this.now().toISOString(),
        reason: "The simulator has no matching command.",
      };
    }
    await this.finishCommand(commandId, "CANCELLED", "Mission cancelled by Fleet Control.");
    return {
      ...active.receipt,
      receivedAt: this.now().toISOString(),
      status: "ACCEPTED",
    };
  }

  subscribe(handler: RobotAdapterEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async startMission(commandId: string): Promise<void> {
    this.assertConnected();
    const active = this.requireAcceptedCommand(commandId);
    const state = this.requireState(active.command.robotId);
    if (state.availability !== "RESERVED") {
      throw new Error(`Command ${commandId} cannot start from ${state.availability}.`);
    }

    const observedAt = this.now().toISOString();
    const nextState: RobotStateSnapshot = {
      ...state,
      sequence: state.sequence + 1,
      observedAt,
      availability: "EXECUTING",
      activeMissionId: active.command.missionId,
    };
    this.states.set(active.command.robotId, nextState);

    await this.emit({
      type: "MISSION_STATUS",
      robotId: active.command.robotId,
      missionId: active.command.missionId,
      commandId,
      status: "EXECUTING",
      observedAt,
    });
    await this.emit({ type: "ROBOT_STATE", state: structuredClone(nextState) });
  }

  async completeMission(commandId: string): Promise<void> {
    await this.finishCommand(commandId, "COMPLETED");
  }

  async failMission(commandId: string, reason: string): Promise<void> {
    await this.finishCommand(commandId, "FAILED", reason);
  }

  private rejectionReason(
    command: MissionCommand,
    state: RobotStateSnapshot,
    descriptor: RobotDescriptor,
  ): string | null {
    if (state.connection !== "ONLINE") return "Robot is offline.";
    if (state.availability !== "AVAILABLE") return `Robot is ${state.availability}.`;
    if (state.pose.mapId !== command.mapId) return "Robot and mission map versions do not match.";
    if (new Date(command.expiresAt).getTime() <= this.now().getTime()) return "Command has expired.";
    if (descriptor.capabilities.actions.length === 0) return "Robot exposes no executable capabilities.";
    return null;
  }

  private async finishCommand(
    commandId: string,
    status: "COMPLETED" | "FAILED" | "CANCELLED",
    reason?: string,
  ): Promise<void> {
    this.assertConnected();
    const active = this.requireAcceptedCommand(commandId);
    const state = this.requireState(active.command.robotId);
    if (state.availability !== "EXECUTING" && status !== "CANCELLED") {
      throw new Error(`Command ${commandId} cannot finish from ${state.availability}.`);
    }

    const observedAt = this.now().toISOString();
    const nextState: RobotStateSnapshot = {
      ...state,
      sequence: state.sequence + 1,
      observedAt,
      availability: "AVAILABLE",
      activeMissionId: null,
    };
    this.states.set(active.command.robotId, nextState);

    await this.emit({
      type: "MISSION_STATUS",
      robotId: active.command.robotId,
      missionId: active.command.missionId,
      commandId,
      status,
      observedAt,
      ...(reason ? { reason } : {}),
    });
    await this.emit({ type: "ROBOT_STATE", state: structuredClone(nextState) });
  }

  private scheduleAutoAdvance(commandId: string): void {
    const startTimer = setTimeout(() => {
      void this.startMission(commandId).then(() => {
        const completeTimer = setTimeout(() => {
          void this.completeMission(commandId);
        }, this.completionDelayMs);
        completeTimer.unref?.();
      });
    }, this.startDelayMs);
    startTimer.unref?.();
  }

  private requireAcceptedCommand(commandId: string): ActiveCommand {
    const active = this.commands.get(commandId);
    if (!active || active.receipt.status !== "ACCEPTED") {
      throw new Error(`Accepted simulator command ${commandId} was not found.`);
    }
    return active;
  }

  private requireState(robotId: string): RobotStateSnapshot {
    const state = this.states.get(robotId);
    if (!state) throw new Error(`Simulator robot ${robotId} was not found.`);
    return state;
  }

  private async emit(event: RobotAdapterEvent): Promise<void> {
    await Promise.all([...this.handlers].map((handler) => handler(structuredClone(event))));
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error("Simulator adapter is not connected.");
  }
}

