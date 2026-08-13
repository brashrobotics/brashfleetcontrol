export const FLEET_SCHEMA_VERSION = "1.0" as const;

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
  lastSeenAt: string;
  connectionChangedAt: string;
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
  | "RECOVERY_REQUIRED"
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
  recoveryPreviousState: "ASSIGNED" | "DISPATCHED" | "EXECUTING" | null;
  recoveryStartedAt: string | null;
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

export interface MissionQueueEntryView {
  missionId: string;
  basePriority: number;
  effectivePriority: number;
  attemptCount: number;
  enqueuedAt: string;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface DispatchQueueView {
  evaluatedAt: string;
  pendingMissions: number;
  dueMissions: number;
  leasedMissions: number;
  nextAttemptAt: string | null;
  entries: MissionQueueEntryView[];
}

export type AlarmSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AlarmStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export type AlarmSourceType = "ROBOT" | "MISSION" | "TRAFFIC" | "SYSTEM";

export interface AlarmView {
  alarmId: string;
  fingerprint: string;
  code: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  title: string;
  message: string;
  sourceType: AlarmSourceType;
  sourceId: string;
  occurrenceCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgementNote: string | null;
  resolvedAt: string | null;
}

export interface AlarmSummaryView {
  evaluatedAt: string;
  open: number;
  acknowledged: number;
  critical: number;
  warning: number;
  alarms: AlarmView[];
}

export interface AlarmActionRequest {
  operatorId: string;
  note?: string;
}

export type MapNodeKind = "WAYPOINT" | "INTERSECTION" | "STATION" | "HOLDING_POINT";

export interface MapNodeView {
  nodeId: string;
  label: string;
  kind: MapNodeKind;
  x: number;
  y: number;
  stationId?: string;
  zoneId?: string;
}

export interface MapEdgeView {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  directed: boolean;
  lengthMeters: number;
  travelTimeSeconds: number;
}

export interface MapTopologyView {
  mapId: string;
  displayName: string;
  revision: number;
  nodes: MapNodeView[];
  edges: MapEdgeView[];
}

export type RoutePhase = "TO_PICKUP" | "TO_DROPOFF";
export type TrafficPlanStatus = "ACTIVE" | "SAFETY_HOLD" | "RELEASED";
export type TrafficReservationState = "ACTIVE" | "SAFETY_HOLD" | "RELEASED";
export type TrafficResourceType = "EDGE" | "NODE";

export interface TrafficRouteSegmentView {
  sequence: number;
  phase: RoutePhase;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  lengthMeters: number;
  enterAt: string;
  exitAt: string;
}

export interface TrafficReservationView {
  reservationId: string;
  routeId: string;
  missionId: string;
  robotId: string;
  mapId: string;
  resourceId: string;
  resourceType: TrafficResourceType;
  sequence: number;
  startsAt: string;
  endsAt: string;
  state: TrafficReservationState;
  releasedAt: string | null;
}

export interface TrafficPlanView {
  routeId: string;
  missionId: string;
  robotId: string;
  mapId: string;
  status: TrafficPlanStatus;
  originNodeId: string;
  pickupNodeId: string;
  dropoffNodeId: string;
  requestedStartAt: string;
  scheduledStartAt: string;
  expectedArrivalAt: string;
  totalDistanceMeters: number;
  totalWaitSeconds: number;
  segments: TrafficRouteSegmentView[];
  plannedAt: string;
  lastRenewedAt: string;
  leaseExpiresAt: string;
  releasedAt: string | null;
}

export interface TrafficScheduleView {
  mapId: string;
  updatedAt: string;
  plans: TrafficPlanView[];
  reservations: TrafficReservationView[];
}

export interface FleetRecoveryStatusView {
  evaluatedAt: string;
  degradedRobots: number;
  offlineRobots: number;
  recoveryRequiredMissions: number;
  safetyHolds: number;
  nextLeaseExpiryAt: string | null;
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
  route?: {
    routeId: string;
    scheduledStartAt: string;
    expectedArrivalAt: string;
    segments: TrafficRouteSegmentView[];
  };
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
  route: TrafficPlanView | null;
}

export interface MissionCancellationResult {
  mission: MissionView;
  receipt: CommandReceipt | null;
}

export type MissionEventType =
  | "MISSION_QUEUED"
  | "ASSIGNMENT_NOT_FOUND"
  | "MISSION_ASSIGNED"
  | "ROUTE_RESERVED"
  | "ROUTE_DELAYED"
  | "ROUTE_RELEASED"
  | "ROBOT_CONNECTION_DEGRADED"
  | "ROBOT_OFFLINE"
  | "MISSION_RECOVERY_REQUIRED"
  | "MISSION_RECOVERED"
  | "MISSION_RECOVERY_REQUEUED"
  | "TRAFFIC_SAFETY_HOLD"
  | "COMMAND_DELIVERY_FAILED"
  | "COMMAND_DISPATCHED"
  | "COMMAND_REJECTED"
  | "MISSION_CANCELLATION_REQUESTED"
  | "MISSION_CANCELLATION_DELIVERY_FAILED"
  | "MISSION_CANCELLATION_REJECTED"
  | "MISSION_EXECUTING"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED"
  | "MISSION_CANCELLED";

export interface MissionEventView {
  eventId: string;
  missionId: string;
  type: MissionEventType;
  state: MissionState;
  robotId: string | null;
  commandId: string | null;
  message: string;
  data: Record<string, unknown>;
  occurredAt: string;
}
