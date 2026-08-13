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
  profileId?: string;
  profileVersion?: number;
  dimensionsMeters?: RobotDimensions;
  supportedFloorTypes?: string[];
  attachments?: string[];
  supportsCancellation?: boolean;
  adapterProtocolVersion?: string;
}

export interface RobotDimensions {
  length: number;
  width: number;
  height: number;
  turningRadius: number;
}

export interface RobotAssignmentConstraints {
  requiredAttachments?: string[];
  requiredFloorType?: string;
  maxRobotWidthMeters?: number;
  requiresCancellationSupport?: boolean;
}

export type CapabilityProfileStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface CreateCapabilityProfileRequest {
  vendor: string;
  model: string;
  version: number;
  displayName: string;
  actions: string[];
  maxPayloadKg: number;
  allowedZones: string[];
  dimensionsMeters: RobotDimensions;
  supportedFloorTypes: string[];
  attachments: string[];
  supportsCancellation: boolean;
  adapterProtocolVersion: string;
  operatorId: string;
}

export interface CapabilityProfileView extends CreateCapabilityProfileRequest {
  profileId: string;
  status: CapabilityProfileStatus;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
}

export interface AssignCapabilityProfileRequest {
  profileId: string;
  operatorId: string;
}

export interface QuarantineRobotRequest {
  reason: string;
  operatorId: string;
}

export interface ReleaseRobotQuarantineRequest {
  inspectionReference: string;
  operatorId: string;
}

export interface ReassignRecoveryMissionRequest {
  commandCleared: boolean;
  clearanceEvidence: string;
  targetRobotId?: string;
  operatorId: string;
}

export interface RobotOperatorControlView {
  robotId: string;
  status: "QUARANTINED" | "CLEARED";
  reason: string;
  quarantinedBy: string;
  quarantinedAt: string;
  clearedBy: string | null;
  clearedAt: string | null;
  inspectionReference: string | null;
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
  robotConstraints?: RobotAssignmentConstraints;
  preferredRobotId?: string;
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
  preferredRobotId?: string;
  priority: number;
  requiredCapabilities: string[];
  payloadKg: number;
  pickup: MissionLocation;
  dropoff: MissionLocation;
  robotConstraints?: RobotAssignmentConstraints;
  state: MissionState;
  assignedRobotId: string | null;
  commandId: string | null;
  createdAt: string;
  updatedAt: string;
  failureReason: string | null;
  recoveryPreviousState: "ASSIGNED" | "DISPATCHED" | "EXECUTING" | null;
  recoveryStartedAt: string | null;
}

export type WorkflowStepType = "TRANSPORT" | "WAIT" | "CHARGE" | "INSPECT" | "DOCK";
export type WorkflowStatus = "PENDING" | "RUNNING" | "CANCELLING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type WorkflowStepStatus = "PENDING" | "WAITING_RETRY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface WorkflowStepDefinition {
  stepId: string;
  name: string;
  type: WorkflowStepType;
  dependsOn: string[];
  timeoutSeconds: number;
  maxAttempts: number;
  retryDelaySeconds: number;
  mission?: CreateMissionRequest;
  resourceId?: string;
  durationSeconds?: number;
}

export interface CreateWorkflowRequest {
  name: string;
  externalReference?: string;
  steps: WorkflowStepDefinition[];
}

export interface WorkflowStepView extends WorkflowStepDefinition {
  status: WorkflowStepStatus;
  attemptCount: number;
  missionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  nextAttemptAt: string;
  timeoutAt: string | null;
  waitUntil: string | null;
  lastError: string | null;
}

export interface WorkflowView {
  workflowId: string;
  name: string;
  externalReference: string | null;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  steps: WorkflowStepView[];
}

export type WorkflowTemplateStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface WorkflowTemplateParameterDefinition {
  name: string;
  required: boolean;
  defaultValue?: string;
  allowedValues?: string[];
}

export interface CreateWorkflowTemplateRequest {
  templateKey: string;
  version: number;
  name: string;
  description: string;
  parameters: WorkflowTemplateParameterDefinition[];
  steps: WorkflowStepDefinition[];
  operatorId: string;
}

export interface InstantiateWorkflowTemplateRequest {
  name?: string;
  externalReference?: string;
  parameters: Record<string, string>;
}

export interface WorkflowTemplateView extends CreateWorkflowTemplateRequest {
  templateId: string;
  status: WorkflowTemplateStatus;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
}

export type WorkOrderStatus = "PENDING" | "ALLOCATED" | "RUNNING" | "CANCELLING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type WorkOrderFollowUpType = "WAIT" | "CHARGE" | "INSPECT" | "DOCK";

export interface WorkOrderFollowUpAction {
  actionId: string;
  name: string;
  type: WorkOrderFollowUpType;
  durationSeconds: number;
  resourceId?: string;
}

export interface CreateWorkOrderRequest {
  name: string;
  externalReference?: string;
  priority: number;
  requiredCapabilities: string[];
  payloadKg: number;
  pickup: MissionLocation;
  dropoff: MissionLocation;
  robotConstraints?: RobotAssignmentConstraints;
  followUpActions?: WorkOrderFollowUpAction[];
}

export interface OrchestratorCandidateView {
  robotId: string;
  eligible: boolean;
  score: number | null;
  reasons: string[];
}

export interface WorkOrderView extends Omit<CreateWorkOrderRequest, "externalReference"> {
  workOrderId: string;
  externalReference: string | null;
  status: WorkOrderStatus;
  selectedRobotId: string | null;
  workflowId: string | null;
  allocationAttemptCount: number;
  nextAttemptAt: string;
  failureReason: string | null;
  candidates: OrchestratorCandidateView[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type IntegrationDeliveryStatus = "PENDING" | "DELIVERED" | "DEAD_LETTER";

export interface IntegrationEventView {
  eventId: string;
  idempotencyKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: IntegrationDeliveryStatus;
  attemptCount: number;
  occurredAt: string;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
  responseStatus: number | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export type FleetRole = "VIEWER" | "OPERATOR" | "DISPATCHER" | "FLEET_ADMIN" | "INTEGRATION";
export type FleetPermission =
  | "fleet:read"
  | "mission:create"
  | "mission:dispatch"
  | "mission:cancel"
  | "workflow:create"
  | "workflow:cancel"
  | "template:manage"
  | "orchestrator:submit"
  | "orchestrator:cancel"
  | "alarm:acknowledge"
  | "traffic:manage"
  | "map:manage"
  | "resource:manage"
  | "capability:manage"
  | "recovery:manage"
  | "integration:read"
  | "integration:manage"
  | "observability:read"
  | "audit:read";

export interface IdentityView {
  subjectId: string;
  displayName: string;
  subjectType: "USER" | "SERVICE";
  role: FleetRole;
  permissions: FleetPermission[];
  siteIds: string[];
}

export type AuditOutcome = "ATTEMPTED" | "SUCCEEDED" | "DENIED" | "FAILED";

export interface AuditEventView {
  auditEventId: string;
  occurredAt: string;
  actorId: string;
  actorDisplayName: string;
  actorRole: FleetRole | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  correlationId: string;
  requestMethod: string;
  requestPath: string;
  siteId: string | null;
  metadata: Record<string, unknown>;
}

export interface OperationalAnalyticsView {
  generatedAt: string;
  robots: {
    total: number;
    online: number;
    degraded: number;
    offline: number;
    available: number;
    utilized: number;
    utilizationPercent: number;
  };
  missions: {
    total: number;
    active: number;
    queued: number;
    completed: number;
    failed: number;
    cancelled: number;
    completionRatePercent: number;
  };
  workflows: {
    total: number;
    active: number;
    succeeded: number;
    failed: number;
    retryCount: number;
  };
  workOrders: {
    total: number;
    pending: number;
    allocated: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  traffic: {
    activeRoutes: number;
    activeReservations: number;
    delayedRoutes: number;
    scheduledWaitSeconds: number;
  };
  alarms: {
    open: number;
    acknowledged: number;
    critical: number;
    warning: number;
  };
}

export interface RobotView extends RobotDescriptor {
  state: RobotStateSnapshot;
  operatorControl: RobotOperatorControlView | null;
}

export interface FleetSnapshot {
  schemaVersion: typeof FLEET_SCHEMA_VERSION;
  siteId: string;
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

export type TrafficRestrictionStatus = "ACTIVE" | "CLEARED";

export interface TrafficRestrictionView {
  restrictionId: string;
  mapId: string;
  resourceId: string;
  status: TrafficRestrictionStatus;
  reason: string;
  createdBy: string;
  createdAt: string;
  clearedBy: string | null;
  clearedAt: string | null;
}

export interface CreateTrafficRestrictionRequest {
  mapId: string;
  resourceId: string;
  reason: string;
  operatorId: string;
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

export type MapVersionStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface MapVersionView {
  mapId: string;
  familyId: string;
  displayName: string;
  revision: number;
  status: MapVersionStatus;
  createdBy: string;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
  nodeCount: number;
  edgeCount: number;
}

export interface CreateMapVersionRequest {
  familyId: string;
  displayName: string;
  revision: number;
  nodes: MapNodeView[];
  edges: MapEdgeView[];
  operatorId: string;
}

export type InfrastructureResourceType = "DOOR" | "ELEVATOR" | "CHARGER" | "DOCK" | "WORKCELL";
export type InfrastructureResourceStatus = "AVAILABLE" | "UNAVAILABLE" | "MAINTENANCE";
export type InfrastructureReservationPolicy = "TRANSIT_EXCLUSIVE" | "SERVICE_EXCLUSIVE";

export interface InfrastructureResourceView {
  resourceId: string;
  mapId: string;
  displayName: string;
  type: InfrastructureResourceType;
  status: InfrastructureResourceStatus;
  reservationPolicy: InfrastructureReservationPolicy;
  edgeId: string | null;
  nodeId: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  statusReason: string | null;
}

export interface CreateInfrastructureResourceRequest {
  resourceId: string;
  mapId: string;
  displayName: string;
  type: InfrastructureResourceType;
  reservationPolicy: InfrastructureReservationPolicy;
  edgeId?: string;
  nodeId?: string;
  operatorId: string;
}

export interface UpdateInfrastructureResourceStatusRequest {
  status: InfrastructureResourceStatus;
  reason: string;
  operatorId: string;
}

export type RoutePhase = "TO_PICKUP" | "TO_DROPOFF";
export type TrafficPlanStatus = "ACTIVE" | "SAFETY_HOLD" | "RELEASED";
export type TrafficReservationState = "ACTIVE" | "SAFETY_HOLD" | "RELEASED";
export type TrafficResourceType = "EDGE" | "NODE" | "INFRASTRUCTURE";

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

export interface ReplanMissionRouteRequest {
  reason: string;
  operatorId: string;
  excludedResourceIds?: string[];
}

export interface TrafficRouteRevisionView {
  missionId: string;
  routeId: string;
  revision: number;
  supersedesRouteId: string | null;
  reason: string;
  triggeredBy: string;
  createdAt: string;
  status: TrafficPlanStatus;
}

export interface RouteReplanResult {
  route: TrafficPlanView;
  revision: TrafficRouteRevisionView;
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
  quarantinedRobots: number;
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
  | "MISSION_OPERATOR_REASSIGNED"
  | "ROBOT_OPERATOR_QUARANTINED"
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
