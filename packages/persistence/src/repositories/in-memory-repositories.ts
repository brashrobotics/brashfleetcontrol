import type {
  AssignmentDecisionRepository,
  CommandRepository,
  MissionRepository,
  PendingCommand,
  RepositoryReadOptions,
  RobotRepository,
} from "@brash/application";
import type {
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
} from "@brash/contracts";
import type { Mission, Robot } from "@brash/domain";

export class InMemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, Mission>();

  async getById(missionId: string, _options?: RepositoryReadOptions): Promise<Mission | null> {
    return this.missions.get(missionId) ?? null;
  }

  async findByExternalReference(externalReference: string): Promise<Mission | null> {
    for (const mission of this.missions.values()) {
      if (mission.externalReference === externalReference) return mission;
    }
    return null;
  }

  async list(): Promise<Mission[]> {
    return [...this.missions.values()].sort((left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime()
      || left.missionId.localeCompare(right.missionId),
    );
  }

  async save(mission: Mission): Promise<void> {
    this.missions.set(mission.missionId, mission);
  }
}

export class InMemoryRobotRepository implements RobotRepository {
  private readonly robots = new Map<string, Robot>();

  async getById(robotId: string, _options?: RepositoryReadOptions): Promise<Robot | null> {
    return this.robots.get(robotId) ?? null;
  }

  async list(_options?: RepositoryReadOptions): Promise<Robot[]> {
    return [...this.robots.values()].sort((left, right) => left.robotId.localeCompare(right.robotId));
  }

  async save(robot: Robot): Promise<void> {
    this.robots.set(robot.robotId, robot);
  }
}

interface StoredCommand extends PendingCommand {
  createdAt: Date;
  receipt: CommandReceipt | null;
}

export class InMemoryCommandRepository implements CommandRepository {
  private readonly commands = new Map<string, StoredCommand>();

  async enqueue(command: MissionCommand, createdAt: Date): Promise<void> {
    if (this.commands.has(command.commandId)) return;
    this.commands.set(command.commandId, {
      command: structuredClone(command),
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      createdAt: new Date(createdAt),
      receipt: null,
    });
  }

  async listPending(): Promise<PendingCommand[]> {
    return [...this.commands.values()]
      .filter((entry) => entry.receipt === null)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((entry) => ({
        command: structuredClone(entry.command),
        attemptCount: entry.attemptCount,
        lastAttemptAt: entry.lastAttemptAt ? new Date(entry.lastAttemptAt) : null,
        lastError: entry.lastError,
      }));
  }

  async recordAttempt(commandId: string, attemptedAt: Date): Promise<void> {
    const entry = this.require(commandId);
    entry.attemptCount += 1;
    entry.lastAttemptAt = new Date(attemptedAt);
    entry.lastError = null;
  }

  async recordAttemptFailure(commandId: string, reason: string, attemptedAt: Date): Promise<void> {
    const entry = this.require(commandId);
    entry.lastAttemptAt = new Date(attemptedAt);
    entry.lastError = reason;
  }

  async recordReceipt(receipt: CommandReceipt): Promise<void> {
    const entry = this.require(receipt.commandId);
    entry.receipt = structuredClone(receipt);
    entry.lastError = receipt.reason ?? null;
  }

  private require(commandId: string): StoredCommand {
    const entry = this.commands.get(commandId);
    if (!entry) throw new Error(`Command ${commandId} was not found.`);
    return entry;
  }
}

export class InMemoryAssignmentDecisionRepository implements AssignmentDecisionRepository {
  private readonly decisions: Array<{ decision: AssignmentDecision; decidedAt: Date }> = [];

  async save(decision: AssignmentDecision, decidedAt: Date): Promise<void> {
    this.decisions.push({ decision: structuredClone(decision), decidedAt: new Date(decidedAt) });
  }

  async list(): Promise<Array<{ decision: AssignmentDecision; decidedAt: Date }>> {
    return this.decisions.map((entry) => ({
      decision: structuredClone(entry.decision),
      decidedAt: new Date(entry.decidedAt),
    }));
  }
}
