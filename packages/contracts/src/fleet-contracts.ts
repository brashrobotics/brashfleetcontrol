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
export type TrafficPlanStatus = "ACTIVE" | "RELEASED";
export type TrafficReservationState = "ACTIVE" | "RELEASED";
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
  releasedAt: string | null;
}

export interface TrafficScheduleView {
  mapId: string;
  updatedAt: string;
  plans: TrafficPlanView[];
  reservations: TrafficReservationView[];
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

export type MissionEventType =
  | "MISSION_QUEUED"
  | "ASSIGNMENT_NOT_FOUND"
  | "MISSION_ASSIGNED"
  | "ROUTE_RESERVED"
  | "ROUTE_DELAYED"
  | "ROUTE_RELEASED"
  | "COMMAND_DELIVERY_FAILED"
  | "COMMAND_DISPATCHED"
  | "COMMAND_REJECTED"
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
