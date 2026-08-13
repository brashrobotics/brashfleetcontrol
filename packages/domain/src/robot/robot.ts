import { DomainError } from "../shared/domain-error.js";

export type RobotConnection = "ONLINE" | "DEGRADED" | "OFFLINE";
export type RobotAvailability =
  | "AVAILABLE"
  | "RESERVED"
  | "EXECUTING"
  | "CHARGING"
  | "ERROR"
  | "MANUAL";

export interface RobotPose {
  mapId: string;
  x: number;
  y: number;
  yaw: number;
}

export interface RobotRegistration {
  robotId: string;
  displayName: string;
  vendor: string;
  model: string;
  capabilities: string[];
  maxPayloadKg: number;
  allowedZones: string[];
}

export interface RobotTelemetry {
  robotId: string;
  sequence: number;
  observedAt: Date;
  connection: RobotConnection;
  availability: RobotAvailability;
  batteryPercent: number;
  pose: RobotPose;
  activeMissionId: string | null;
}

export interface RobotSnapshot extends RobotRegistration, RobotTelemetry {
  lastSeenAt: Date;
  connectionChangedAt: Date;
}

export class Robot {
  readonly robotId: string;
  readonly displayName: string;
  readonly vendor: string;
  readonly model: string;
  readonly capabilities: readonly string[];
  readonly maxPayloadKg: number;
  readonly allowedZones: readonly string[];

  private telemetry: RobotTelemetry;
  private currentLastSeenAt: Date;
  private currentConnectionChangedAt: Date;

  private constructor(
    registration: RobotRegistration,
    telemetry: RobotTelemetry,
    lastSeenAt = telemetry.observedAt,
    connectionChangedAt = telemetry.observedAt,
  ) {
    this.robotId = registration.robotId;
    this.displayName = registration.displayName;
    this.vendor = registration.vendor;
    this.model = registration.model;
    this.capabilities = Object.freeze([...new Set(registration.capabilities)]);
    this.maxPayloadKg = registration.maxPayloadKg;
    this.allowedZones = Object.freeze([...new Set(registration.allowedZones)]);
    this.telemetry = { ...telemetry, pose: { ...telemetry.pose }, observedAt: new Date(telemetry.observedAt) };
    this.currentLastSeenAt = new Date(lastSeenAt);
    this.currentConnectionChangedAt = new Date(connectionChangedAt);
  }

  static register(registration: RobotRegistration, telemetry: RobotTelemetry): Robot {
    if (!registration.robotId.trim()) throw new DomainError("ROBOT_ID_REQUIRED", "Robot ID is required.");
    if (registration.robotId !== telemetry.robotId) {
      throw new DomainError("ROBOT_ID_MISMATCH", "Robot registration and telemetry IDs must match.");
    }
    if (registration.maxPayloadKg < 0) {
      throw new DomainError("ROBOT_PAYLOAD_INVALID", "Robot payload capacity cannot be negative.");
    }
    Robot.assertBattery(telemetry.batteryPercent);
    return new Robot(registration, telemetry);
  }

  static restore(snapshot: RobotSnapshot): Robot {
    const robot = Robot.register({
      robotId: snapshot.robotId,
      displayName: snapshot.displayName,
      vendor: snapshot.vendor,
      model: snapshot.model,
      capabilities: [...snapshot.capabilities],
      maxPayloadKg: snapshot.maxPayloadKg,
      allowedZones: [...snapshot.allowedZones],
    }, {
      robotId: snapshot.robotId,
      sequence: snapshot.sequence,
      observedAt: snapshot.observedAt,
      connection: snapshot.connection,
      availability: snapshot.availability,
      batteryPercent: snapshot.batteryPercent,
      pose: { ...snapshot.pose },
      activeMissionId: snapshot.activeMissionId,
    });
    robot.currentLastSeenAt = new Date(snapshot.lastSeenAt);
    robot.currentConnectionChangedAt = new Date(snapshot.connectionChangedAt);
    return robot;
  }

  get connection(): RobotConnection {
    return this.telemetry.connection;
  }

  get availability(): RobotAvailability {
    return this.telemetry.availability;
  }

  get batteryPercent(): number {
    return this.telemetry.batteryPercent;
  }

  get pose(): RobotPose {
    return { ...this.telemetry.pose };
  }

  get activeMissionId(): string | null {
    return this.telemetry.activeMissionId;
  }

  get lastSeenAt(): Date {
    return new Date(this.currentLastSeenAt);
  }

  get connectionChangedAt(): Date {
    return new Date(this.currentConnectionChangedAt);
  }

  applyTelemetry(next: RobotTelemetry, receivedAt = next.observedAt): boolean {
    if (next.robotId !== this.robotId) throw new DomainError("ROBOT_ID_MISMATCH", "Telemetry targets another robot.");
    Robot.assertBattery(next.batteryPercent);
    if (next.sequence <= this.telemetry.sequence) return false;
    const connectionChanged = next.connection !== this.telemetry.connection;
    this.telemetry = { ...next, pose: { ...next.pose }, observedAt: new Date(next.observedAt) };
    this.currentLastSeenAt = new Date(receivedAt);
    if (connectionChanged) this.currentConnectionChangedAt = new Date(receivedAt);
    return true;
  }

  markConnection(connection: RobotConnection, at: Date): boolean {
    if (connection === this.telemetry.connection) return false;
    this.telemetry = { ...this.telemetry, connection };
    this.currentConnectionChangedAt = new Date(at);
    return true;
  }

  acknowledgeContact(at: Date): void {
    this.currentLastSeenAt = new Date(at);
    if (this.telemetry.connection !== "ONLINE") {
      this.telemetry = { ...this.telemetry, connection: "ONLINE" };
      this.currentConnectionChangedAt = new Date(at);
    }
  }

  quarantine(missionId: string, at: Date): void {
    if (this.activeMissionId !== missionId && this.activeMissionId !== null) {
      throw new DomainError("ROBOT_MISSION_MISMATCH", `${this.robotId} is assigned to another mission.`);
    }
    this.telemetry = {
      ...this.telemetry,
      sequence: this.telemetry.sequence + 1,
      observedAt: new Date(at),
      availability: "ERROR",
      activeMissionId: null,
    };
  }

  reserve(missionId: string, at: Date): void {
    if (this.connection !== "ONLINE") throw new DomainError("ROBOT_OFFLINE", `${this.robotId} is offline.`);
    if (this.availability !== "AVAILABLE") {
      throw new DomainError("ROBOT_NOT_AVAILABLE", `${this.robotId} is ${this.availability}.`);
    }
    this.telemetry = {
      ...this.telemetry,
      sequence: this.telemetry.sequence + 1,
      observedAt: new Date(at),
      availability: "RESERVED",
      activeMissionId: missionId,
    };
  }

  markExecuting(missionId: string, at: Date): void {
    if (this.activeMissionId !== missionId) {
      throw new DomainError("ROBOT_MISSION_MISMATCH", `${this.robotId} is not assigned to ${missionId}.`);
    }
    if (this.availability !== "RESERVED" && this.availability !== "EXECUTING") {
      throw new DomainError("ROBOT_STATE_INVALID", `${this.robotId} cannot start from ${this.availability}.`);
    }
    this.telemetry = {
      ...this.telemetry,
      sequence: this.telemetry.sequence + 1,
      observedAt: new Date(at),
      availability: "EXECUTING",
    };
  }

  release(missionId: string, at: Date): void {
    if (this.activeMissionId !== missionId && this.activeMissionId !== null) {
      throw new DomainError("ROBOT_MISSION_MISMATCH", `${this.robotId} is assigned to another mission.`);
    }
    this.telemetry = {
      ...this.telemetry,
      sequence: this.telemetry.sequence + 1,
      observedAt: new Date(at),
      availability: "AVAILABLE",
      activeMissionId: null,
    };
  }

  snapshot(): RobotSnapshot {
    return {
      robotId: this.robotId,
      displayName: this.displayName,
      vendor: this.vendor,
      model: this.model,
      capabilities: [...this.capabilities],
      maxPayloadKg: this.maxPayloadKg,
      allowedZones: [...this.allowedZones],
      sequence: this.telemetry.sequence,
      observedAt: new Date(this.telemetry.observedAt),
      connection: this.telemetry.connection,
      availability: this.telemetry.availability,
      batteryPercent: this.telemetry.batteryPercent,
      pose: { ...this.telemetry.pose },
      activeMissionId: this.telemetry.activeMissionId,
      lastSeenAt: new Date(this.currentLastSeenAt),
      connectionChangedAt: new Date(this.currentConnectionChangedAt),
    };
  }

  private static assertBattery(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new DomainError("ROBOT_BATTERY_INVALID", "Battery percentage must be between 0 and 100.");
    }
  }
}
