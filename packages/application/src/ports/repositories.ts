import type {
  AlarmSeverity,
  AlarmSourceType,
  AlarmStatus,
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
  MissionEventType,
  MissionEventView,
  MissionState,
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

export interface RobotRepository {
  getById(robotId: string, options?: RepositoryReadOptions): Promise<Robot | null>;
  list(options?: RepositoryReadOptions): Promise<Robot[]>;
  save(robot: Robot): Promise<void>;
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

export interface TransactionManager {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}
