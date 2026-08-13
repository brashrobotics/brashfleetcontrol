import { DomainError } from "../shared/domain-error.js";

export type MissionState =
  | "CREATED"
  | "QUEUED"
  | "ASSIGNED"
  | "DISPATCHED"
  | "EXECUTING"
  | "RECOVERY_REQUIRED"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export interface MissionLocation {
  stationId: string;
  mapId: string;
  x: number;
  y: number;
  zoneId?: string;
}

export interface CreateMissionProps {
  missionId: string;
  externalReference?: string;
  priority: number;
  requiredCapabilities: string[];
  payloadKg: number;
  pickup: MissionLocation;
  dropoff: MissionLocation;
  createdAt: Date;
}

export interface MissionSnapshot extends Omit<CreateMissionProps, "createdAt"> {
  state: MissionState;
  assignedRobotId: string | null;
  commandId: string | null;
  createdAt: Date;
  updatedAt: Date;
  failureReason: string | null;
  recoveryPreviousState: RecoverableMissionState | null;
  recoveryStartedAt: Date | null;
}

export type RecoverableMissionState = "ASSIGNED" | "DISPATCHED" | "EXECUTING";

const TERMINAL_STATES = new Set<MissionState>(["CANCELLED", "COMPLETED", "FAILED"]);

export class Mission {
  readonly missionId: string;
  readonly type = "TRANSPORT" as const;
  readonly externalReference?: string;
  readonly priority: number;
  readonly requiredCapabilities: readonly string[];
  readonly payloadKg: number;
  readonly pickup: MissionLocation;
  readonly dropoff: MissionLocation;
  readonly createdAt: Date;

  private currentState: MissionState = "CREATED";
  private currentAssignedRobotId: string | null = null;
  private currentCommandId: string | null = null;
  private currentUpdatedAt: Date;
  private currentFailureReason: string | null = null;
  private currentRecoveryPreviousState: RecoverableMissionState | null = null;
  private currentRecoveryStartedAt: Date | null = null;

  private constructor(props: CreateMissionProps) {
    this.missionId = props.missionId;
    this.externalReference = props.externalReference;
    this.priority = props.priority;
    this.requiredCapabilities = Object.freeze([...new Set(props.requiredCapabilities)]);
    this.payloadKg = props.payloadKg;
    this.pickup = Object.freeze({ ...props.pickup });
    this.dropoff = Object.freeze({ ...props.dropoff });
    this.createdAt = new Date(props.createdAt);
    this.currentUpdatedAt = new Date(props.createdAt);
  }

  static create(props: CreateMissionProps): Mission {
    if (!props.missionId.trim()) throw new DomainError("MISSION_ID_REQUIRED", "Mission ID is required.");
    if (props.priority < 0 || props.priority > 100) {
      throw new DomainError("MISSION_PRIORITY_INVALID", "Mission priority must be between 0 and 100.");
    }
    if (props.payloadKg < 0) throw new DomainError("MISSION_PAYLOAD_INVALID", "Mission payload cannot be negative.");
    if (props.requiredCapabilities.length === 0) {
      throw new DomainError("MISSION_CAPABILITY_REQUIRED", "A mission requires at least one capability.");
    }
    if (props.pickup.mapId !== props.dropoff.mapId) {
      throw new DomainError("MISSION_MAP_MISMATCH", "Pickup and drop-off must use the same map version.");
    }
    return new Mission(props);
  }

  static restore(snapshot: MissionSnapshot): Mission {
    const mission = Mission.create({
      missionId: snapshot.missionId,
      externalReference: snapshot.externalReference,
      priority: snapshot.priority,
      requiredCapabilities: [...snapshot.requiredCapabilities],
      payloadKg: snapshot.payloadKg,
      pickup: { ...snapshot.pickup },
      dropoff: { ...snapshot.dropoff },
      createdAt: snapshot.createdAt,
    });
    mission.currentState = snapshot.state;
    mission.currentAssignedRobotId = snapshot.assignedRobotId;
    mission.currentCommandId = snapshot.commandId;
    mission.currentUpdatedAt = new Date(snapshot.updatedAt);
    mission.currentFailureReason = snapshot.failureReason;
    mission.currentRecoveryPreviousState = snapshot.recoveryPreviousState;
    mission.currentRecoveryStartedAt = snapshot.recoveryStartedAt ? new Date(snapshot.recoveryStartedAt) : null;
    return mission;
  }

  get state(): MissionState {
    return this.currentState;
  }

  get assignedRobotId(): string | null {
    return this.currentAssignedRobotId;
  }

  get commandId(): string | null {
    return this.currentCommandId;
  }

  get updatedAt(): Date {
    return new Date(this.currentUpdatedAt);
  }

  get failureReason(): string | null {
    return this.currentFailureReason;
  }

  get recoveryPreviousState(): RecoverableMissionState | null {
    return this.currentRecoveryPreviousState;
  }

  get recoveryStartedAt(): Date | null {
    return this.currentRecoveryStartedAt ? new Date(this.currentRecoveryStartedAt) : null;
  }

  queue(at: Date): void {
    this.assertState("CREATED", "queue");
    this.transition("QUEUED", at);
  }

  assign(robotId: string, at: Date): void {
    this.assertState("QUEUED", "assign");
    if (!robotId.trim()) throw new DomainError("ROBOT_ID_REQUIRED", "Robot ID is required for assignment.");
    this.currentAssignedRobotId = robotId;
    this.currentFailureReason = null;
    this.transition("ASSIGNED", at);
  }

  releaseRejectedAssignment(reason: string, at: Date): void {
    this.assertState("ASSIGNED", "release a rejected assignment");
    this.currentAssignedRobotId = null;
    this.currentCommandId = null;
    this.currentFailureReason = reason;
    this.transition("QUEUED", at);
  }

  markDispatched(commandId: string, at: Date): void {
    this.assertState("ASSIGNED", "dispatch");
    if (!commandId.trim()) throw new DomainError("COMMAND_ID_REQUIRED", "Command ID is required for dispatch.");
    this.currentCommandId = commandId;
    this.transition("DISPATCHED", at);
  }

  markExecuting(commandId: string, at: Date): void {
    this.assertState("DISPATCHED", "start execution");
    this.assertCommand(commandId);
    this.transition("EXECUTING", at);
  }

  requireRecovery(reason: string, at: Date): void {
    if (!new Set<MissionState>(["ASSIGNED", "DISPATCHED", "EXECUTING"]).has(this.currentState)) {
      throw new DomainError("MISSION_TRANSITION_INVALID", `Cannot require recovery for a mission in ${this.currentState}.`);
    }
    this.currentRecoveryPreviousState = this.currentState as RecoverableMissionState;
    this.currentRecoveryStartedAt = new Date(at);
    this.currentFailureReason = reason || "Robot connectivity was lost.";
    this.transition("RECOVERY_REQUIRED", at);
  }

  resumeRecovery(at: Date): void {
    this.assertState("RECOVERY_REQUIRED", "resume recovery");
    if (!this.currentRecoveryPreviousState) {
      throw new DomainError("MISSION_RECOVERY_STATE_MISSING", "Mission has no state to resume after recovery.");
    }
    const previousState = this.currentRecoveryPreviousState;
    this.currentRecoveryPreviousState = null;
    this.currentRecoveryStartedAt = null;
    this.currentFailureReason = null;
    this.transition(previousState, at);
  }

  requeueAfterRecovery(reason: string, at: Date): void {
    this.assertState("RECOVERY_REQUIRED", "requeue after recovery");
    this.currentAssignedRobotId = null;
    this.currentCommandId = null;
    this.currentRecoveryPreviousState = null;
    this.currentRecoveryStartedAt = null;
    this.currentFailureReason = reason;
    this.transition("QUEUED", at);
  }

  requestCancellation(at: Date): void {
    if (!new Set<MissionState>(["ASSIGNED", "DISPATCHED", "EXECUTING"]).has(this.currentState)) {
      throw new DomainError("MISSION_TRANSITION_INVALID", `Cannot cancel a mission in ${this.currentState}.`);
    }
    this.transition("CANCELLING", at);
  }

  cancel(commandId: string, at: Date): void {
    this.assertState("CANCELLING", "confirm cancellation");
    if (this.currentCommandId) this.assertCommand(commandId);
    this.transition("CANCELLED", at);
  }

  complete(commandId: string, at: Date): void {
    this.assertState("EXECUTING", "complete");
    this.assertCommand(commandId);
    this.transition("COMPLETED", at);
  }

  fail(commandId: string, reason: string, at: Date): void {
    if (TERMINAL_STATES.has(this.currentState) || this.currentState === "CREATED" || this.currentState === "QUEUED") {
      throw new DomainError("MISSION_TRANSITION_INVALID", `Cannot fail a mission in ${this.currentState}.`);
    }
    if (this.currentCommandId) this.assertCommand(commandId);
    this.currentFailureReason = reason || "Robot reported mission failure.";
    this.transition("FAILED", at);
  }

  snapshot(): MissionSnapshot {
    return {
      missionId: this.missionId,
      externalReference: this.externalReference,
      priority: this.priority,
      requiredCapabilities: [...this.requiredCapabilities],
      payloadKg: this.payloadKg,
      pickup: { ...this.pickup },
      dropoff: { ...this.dropoff },
      state: this.currentState,
      assignedRobotId: this.currentAssignedRobotId,
      commandId: this.currentCommandId,
      createdAt: new Date(this.createdAt),
      updatedAt: new Date(this.currentUpdatedAt),
      failureReason: this.currentFailureReason,
      recoveryPreviousState: this.currentRecoveryPreviousState,
      recoveryStartedAt: this.currentRecoveryStartedAt ? new Date(this.currentRecoveryStartedAt) : null,
    };
  }

  private assertState(expected: MissionState, action: string): void {
    if (this.currentState !== expected) {
      throw new DomainError("MISSION_TRANSITION_INVALID", `Cannot ${action} a mission in ${this.currentState}; expected ${expected}.`);
    }
  }

  private assertCommand(commandId: string): void {
    if (!this.currentCommandId || this.currentCommandId !== commandId) {
      throw new DomainError("MISSION_COMMAND_MISMATCH", "Mission status refers to an unexpected command.");
    }
  }

  private transition(state: MissionState, at: Date): void {
    this.currentState = state;
    this.currentUpdatedAt = new Date(at);
  }
}
