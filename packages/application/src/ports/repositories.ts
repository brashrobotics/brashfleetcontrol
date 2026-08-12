import type {
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
} from "@brash/contracts";
import type { Mission, Robot } from "@brash/domain";

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

export interface CommandRepository {
  enqueue(command: MissionCommand, createdAt: Date): Promise<void>;
  listPending(): Promise<PendingCommand[]>;
  recordAttempt(commandId: string, attemptedAt: Date): Promise<void>;
  recordAttemptFailure(commandId: string, reason: string, attemptedAt: Date): Promise<void>;
  recordReceipt(receipt: CommandReceipt): Promise<void>;
}

export interface AssignmentDecisionRepository {
  save(decision: AssignmentDecision, decidedAt: Date): Promise<void>;
}

export interface TransactionManager {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}
