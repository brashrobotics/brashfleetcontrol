export const FLEET_SCHEMA_VERSION = "1.0" as const;

export type RobotConnection = "ONLINE" | "OFFLINE";
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

export interface RobotCapabilities {
  actions: string[];
  maxPayloadKg: number;
  allowedZones: string[];
}

export interface RobotDescriptor {
  robotId: string;
  displayName: string;
  vendor: string;
  model: string;
  capabilities: RobotCapabilities;
}

export interface RobotStateSnapshot {
  schemaVersion: typeof FLEET_SCHEMA_VERSION;
  robotId: string;
  sequence: number;
  observedAt: string;
  connection: RobotConnection;
  availability: RobotAvailability;
  batteryPercent: number;
  pose: RobotPose;
  activeMissionId: string | null;
}

export interface MissionLocation {
  stationId: string;
  mapId: string;
  x: number;
  y: number;
  zoneId?: string;
}

export interface CreateMissionRequest {
  type: "TRANSPORT";
  externalReference?: string;
  priority: number;
  requiredCapabilities: string[];
  payloadKg: number;
  pickup: MissionLocation;
  dropoff: MissionLocation;
  autoDispatch?: boolean;
}

export type MissionState =
  | "CREATED"
  | "QUEUED"
  | "ASSIGNED"
  | "DISPATCHED"
  | "EXECUTING"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export interface MissionView {
  missionId: string;
  type: "TRANSPORT";
  externalReference?: string;
  priority: number;
  requiredCapabilities: string[];
  payloadKg: number;
  pickup: MissionLocation;
  dropoff: MissionLocation;
  state: MissionState;
  assignedRobotId: string | null;
  commandId: string | null;
  createdAt: string;
  updatedAt: string;
  failureReason: string | null;
}

export interface RobotView extends RobotDescriptor {
  state: RobotStateSnapshot;
}

export interface FleetSnapshot {
  schemaVersion: typeof FLEET_SCHEMA_VERSION;
  updatedAt: string;
  robots: RobotView[];
  missions: MissionView[];
}

export type MissionCommandStep =
  | { type: "MOVE_TO"; target: MissionLocation }
  | { type: "LOAD"; stationId: string; payloadKg: number }
  | { type: "UNLOAD"; stationId: string };

export interface MissionCommand {
  schemaVersion: typeof FLEET_SCHEMA_VERSION;
  commandId: string;
  missionId: string;
  robotId: string;
  issuedAt: string;
  expiresAt: string;
  mapId: string;
  steps: MissionCommandStep[];
}

export type CommandReceiptStatus = "ACCEPTED" | "REJECTED";

export interface CommandReceipt {
  schemaVersion: typeof FLEET_SCHEMA_VERSION;
  commandId: string;
  missionId: string;
  robotId: string;
  status: CommandReceiptStatus;
  receivedAt: string;
  reason?: string;
}

export type MissionExecutionStatus =
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type RobotAdapterEvent =
  | {
      type: "ROBOT_STATE";
      state: RobotStateSnapshot;
    }
  | {
      type: "MISSION_STATUS";
      robotId: string;
      missionId: string;
      commandId: string;
      status: MissionExecutionStatus;
      observedAt: string;
      reason?: string;
    };

export interface CandidateEvaluation {
  robotId: string;
  eligible: boolean;
  score: number | null;
  reasons: string[];
}

export interface AssignmentDecision {
  missionId: string;
  selectedRobotId: string | null;
  selectedScore: number | null;
  reasons: string[];
  candidates: CandidateEvaluation[];
}

export interface DispatchResult {
  mission: MissionView;
  decision: AssignmentDecision;
  receipt: CommandReceipt | null;
}

