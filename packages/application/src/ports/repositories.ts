import type {
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
