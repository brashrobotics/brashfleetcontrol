import type {
  AuditOutcome,
  CapabilityProfileStatus,
  CreateCapabilityProfileRequest,
  FleetRole,
  AlarmSeverity,
  AlarmSourceType,
  AlarmStatus,
  CreateWorkOrderRequest,
  AssignmentDecision,
  CommandReceipt,
  InfrastructureReservationPolicy,
  InfrastructureResourceStatus,
  InfrastructureResourceType,
  MapVersionStatus,
  MissionCommand,
  MissionEventType,
  MissionEventView,
  MissionState,
  TrafficRestrictionStatus,
  WorkflowStatus,
  WorkOrderStatus,
  OrchestratorCandidateView,
  WorkflowStepDefinition,
  WorkflowStepStatus,
} from "@brash/contracts";
import type {
  MapTopology,
  Mission,
  Robot,
  TrafficPlanSnapshot,
  TrafficReservationSnapshot,
} from "@brash/domain";

export interface RepositoryReadOptions {
  forUpdate?: boolean;
  skipLocked?: boolean;
}

export interface MissionRepository {
  getById(missionId: string, options?: RepositoryReadOptions): Promise<Mission | null>;
  findByExternalReference(externalReference: string): Promise<Mission | null>;
  list(): Promise<Mission[]>;
  save(mission: Mission): Promise<void>;
}

export interface WorkflowRecord {
  workflowId: string;
  name: string;
  externalReference: string | null;
  status: WorkflowStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
}

export interface WorkflowStepRecord {
  workflowId: string;
  definition: WorkflowStepDefinition;
  status: WorkflowStepStatus;
  attemptCount: number;
  missionId: string | null;
  resourceReservationId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  nextAttemptAt: Date;
  timeoutAt: Date | null;
  waitUntil: Date | null;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
}

export interface WorkflowClaimOptions {
  workerId: string;
  claimedAt: Date;
  leaseDurationMs: number;
}

export interface WorkflowRepository {
  findByExternalReference(externalReference: string): Promise<WorkflowRecord | null>;
  create(workflow: WorkflowRecord, steps: WorkflowStepRecord[]): Promise<void>;
  getById(workflowId: string): Promise<{ workflow: WorkflowRecord; steps: WorkflowStepRecord[] } | null>;
  list(): Promise<WorkflowRecord[]>;
  claimRunnable(limit: number, options: WorkflowClaimOptions): Promise<WorkflowStepRecord[]>;
  saveStep(step: WorkflowStepRecord): Promise<void>;
  saveWorkflow(workflow: WorkflowRecord): Promise<void>;
}

export interface WorkflowResourceReservationRecord {
  reservationId: string;
  workflowId: string;
  stepId: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  state: "ACTIVE" | "RELEASED";
  releasedAt: Date | null;
}

export interface WorkflowResourceReservationRepository {
  getActiveByStep(workflowId: string, stepId: string): Promise<WorkflowResourceReservationRecord | null>;
  tryReserve(reservation: WorkflowResourceReservationRecord): Promise<WorkflowResourceReservationRecord | null>;
  release(reservationId: string, at: Date): Promise<WorkflowResourceReservationRecord | null>;
}

export interface WorkOrderRecord {
  workOrderId: string;
  request: CreateWorkOrderRequest;
  status: WorkOrderStatus;
  selectedRobotId: string | null;
  workflowId: string | null;
  candidates: OrchestratorCandidateView[];
  allocationAttemptCount: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  failureReason: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface WorkOrderClaimOptions {
  workerId: string;
  claimedAt: Date;
  leaseDurationMs: number;
}

export interface WorkOrderRepository {
  findByExternalReference(externalReference: string): Promise<WorkOrderRecord | null>;
  getById(workOrderId: string): Promise<WorkOrderRecord | null>;
  list(): Promise<WorkOrderRecord[]>;
  create(workOrder: WorkOrderRecord): Promise<void>;
  save(workOrder: WorkOrderRecord): Promise<void>;
  claimPending(limit: number, options: WorkOrderClaimOptions): Promise<WorkOrderRecord[]>;
}

export type MissionQueueOutcome = "DISPATCHED" | "CANCELLED";

export interface MissionQueueEntry {
  missionId: string;
  basePriority: number;
  effectivePriority: number;
  attemptCount: number;
  enqueuedAt: Date;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
}

export interface MissionQueueClaimOptions {
  workerId: string;
  claimedAt: Date;
  leaseDurationMs: number;
  agingIntervalMs: number;
}

export interface MissionQueueRepository {
  enqueue(missionId: string, priority: number, enqueuedAt: Date): Promise<void>;
  claimDue(limit: number, options: MissionQueueClaimOptions): Promise<MissionQueueEntry[]>;
  listPending(now: Date, agingIntervalMs: number): Promise<MissionQueueEntry[]>;
  defer(missionId: string, attemptedAt: Date, nextAttemptAt: Date, reason: string): Promise<void>;
  complete(missionId: string, outcome: MissionQueueOutcome, completedAt: Date): Promise<void>;
}

export interface AlarmRecord {
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
  firstOccurredAt: Date;
  lastOccurredAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  acknowledgementNote: string | null;
  resolvedAt: Date | null;
}

export interface RaiseAlarmInput {
  fingerprint: string;
  code: string;
  severity: AlarmSeverity;
  title: string;
  message: string;
  sourceType: AlarmSourceType;
  sourceId: string;
  occurredAt: Date;
}

export interface AlarmRepository {
  raise(input: RaiseAlarmInput): Promise<AlarmRecord>;
  getById(alarmId: string): Promise<AlarmRecord | null>;
  listActive(): Promise<AlarmRecord[]>;
  acknowledge(alarmId: string, operatorId: string, note: string | null, at: Date): Promise<AlarmRecord | null>;
  resolveByFingerprint(fingerprint: string, at: Date): Promise<AlarmRecord | null>;
}

export interface TrafficRestrictionRecord {
  restrictionId: string;
  mapId: string;
  resourceId: string;
  status: TrafficRestrictionStatus;
  reason: string;
  createdBy: string;
  createdAt: Date;
  clearedBy: string | null;
  clearedAt: Date | null;
}

export interface TrafficRestrictionRepository {
  create(mapId: string, resourceId: string, reason: string, operatorId: string, at: Date): Promise<TrafficRestrictionRecord>;
  listActive(mapId: string): Promise<TrafficRestrictionRecord[]>;
  clear(restrictionId: string, operatorId: string, at: Date): Promise<TrafficRestrictionRecord | null>;
}

export interface RobotRepository {
  getById(robotId: string, options?: RepositoryReadOptions): Promise<Robot | null>;
  list(options?: RepositoryReadOptions): Promise<Robot[]>;
  save(robot: Robot): Promise<void>;
}

export interface CapabilityProfileRecord extends CreateCapabilityProfileRequest {
  profileId: string;
  status: CapabilityProfileStatus;
  createdAt: Date;
  publishedBy: string | null;
  publishedAt: Date | null;
  retiredBy: string | null;
  retiredAt: Date | null;
}

export interface CapabilityProfileRepository {
  create(profile: CapabilityProfileRecord): Promise<void>;
  getById(profileId: string): Promise<CapabilityProfileRecord | null>;
  list(): Promise<CapabilityProfileRecord[]>;
  publish(profileId: string, operatorId: string, at: Date): Promise<CapabilityProfileRecord | null>;
  retire(profileId: string, operatorId: string, at: Date): Promise<CapabilityProfileRecord | null>;
}

export interface PendingCommand {
  command: MissionCommand;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
}

export interface CommandClaimOptions {
  workerId: string;
  claimedAt: Date;
  leaseDurationMs: number;
}

export interface CommandRepository {
  enqueue(command: MissionCommand, createdAt: Date): Promise<void>;
  updatePending(command: MissionCommand, updatedAt: Date): Promise<void>;
  deferPendingByMission(missionId: string, nextAttemptAt: Date, reason: string): Promise<void>;
  resumePendingByMission(missionId: string, at: Date): Promise<void>;
  cancelPendingByMission(missionId: string, at: Date, reason: string): Promise<void>;
  claimById(commandId: string, options: CommandClaimOptions): Promise<PendingCommand | null>;
  claimPending(limit: number, options: CommandClaimOptions): Promise<PendingCommand[]>;
  recordAttempt(commandId: string, attemptedAt: Date): Promise<void>;
  recordAttemptFailure(commandId: string, reason: string, attemptedAt: Date, nextAttemptAt: Date): Promise<void>;
  recordReceipt(receipt: CommandReceipt): Promise<void>;
}

export interface MapTopologyRepository {
  getById(mapId: string, options?: RepositoryReadOptions): Promise<MapTopology | null>;
  list(): Promise<MapTopology[]>;
  save(topology: MapTopology): Promise<void>;
  getVersion(mapId: string, options?: RepositoryReadOptions): Promise<MapVersionRecord | null>;
  listVersions(familyId?: string): Promise<MapVersionRecord[]>;
  createDraft(topology: MapTopology, familyId: string, operatorId: string, at: Date): Promise<MapVersionRecord>;
  publish(mapId: string, operatorId: string, at: Date): Promise<MapVersionRecord | null>;
  retire(mapId: string, operatorId: string, at: Date): Promise<MapVersionRecord | null>;
}

export interface MapVersionRecord {
  topology: MapTopology;
  familyId: string;
  status: MapVersionStatus;
  createdBy: string;
  createdAt: Date;
  publishedBy: string | null;
  publishedAt: Date | null;
  retiredBy: string | null;
  retiredAt: Date | null;
}

export interface InfrastructureResourceRecord {
  resourceId: string;
  mapId: string;
  displayName: string;
  type: InfrastructureResourceType;
  status: InfrastructureResourceStatus;
  reservationPolicy: InfrastructureReservationPolicy;
  edgeId: string | null;
  nodeId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
  statusReason: string | null;
}

export interface InfrastructureResourceRepository {
  getById(resourceId: string, options?: RepositoryReadOptions): Promise<InfrastructureResourceRecord | null>;
  listByMap(mapId: string): Promise<InfrastructureResourceRecord[]>;
  create(resource: InfrastructureResourceRecord): Promise<InfrastructureResourceRecord>;
  updateStatus(
    resourceId: string,
    status: InfrastructureResourceStatus,
    reason: string,
    operatorId: string,
    at: Date,
  ): Promise<InfrastructureResourceRecord | null>;
}

export interface TrafficPlanRepository {
  getByMission(missionId: string): Promise<TrafficPlanSnapshot | null>;
  listByMap(mapId: string): Promise<TrafficPlanSnapshot[]>;
  listActiveReservations(
    mapId: string,
    after: Date,
    excludeMissionId?: string,
  ): Promise<TrafficReservationSnapshot[]>;
  save(plan: TrafficPlanSnapshot): Promise<void>;
  renewLeaseByMission(missionId: string, renewedAt: Date, expiresAt: Date): Promise<TrafficPlanSnapshot | null>;
  placeSafetyHoldByMission(missionId: string, at: Date): Promise<TrafficPlanSnapshot | null>;
  acknowledgeSafetyHoldByMission(missionId: string, renewedAt: Date, expiresAt: Date): Promise<TrafficPlanSnapshot | null>;
  releaseByMission(missionId: string, releasedAt: Date): Promise<TrafficPlanSnapshot | null>;
}

export interface AssignmentDecisionRepository {
  save(decision: AssignmentDecision, decidedAt: Date): Promise<void>;
}

export interface NewMissionEvent {
  missionId: string;
  type: MissionEventType;
  state: MissionState;
  robotId: string | null;
  commandId: string | null;
  message: string;
  data?: Record<string, unknown>;
  occurredAt: Date;
}

export interface MissionEventRepository {
  append(event: NewMissionEvent): Promise<void>;
  listByMission(missionId: string): Promise<MissionEventView[]>;
}

export interface AuditEventRecord {
  auditEventId: string;
  occurredAt: Date;
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

export interface AuditEventFilter {
  limit: number;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  correlationId?: string;
}

export interface AuditRepository {
  append(event: AuditEventRecord): Promise<void>;
  list(filter: AuditEventFilter): Promise<AuditEventRecord[]>;
}

export interface TransactionManager {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}
