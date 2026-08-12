import type {
  AssignmentDecisionRepository,
  CommandClaimOptions,
  CommandRepository,
  MissionEventRepository,
  MissionRepository,
  NewMissionEvent,
  PendingCommand,
  RepositoryReadOptions,
  RobotRepository,
} from "@brash/application";
import type {
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
  MissionEventView,
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
  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
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
      nextAttemptAt: new Date(createdAt),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  async claimById(commandId: string, options: CommandClaimOptions): Promise<PendingCommand | null> {
    const entry = this.commands.get(commandId);
    if (!entry || !this.isClaimable(entry, options.claimedAt)) return null;
    this.claim(entry, options);
    return this.toPendingCommand(entry);
  }

  async claimPending(limit: number, options: CommandClaimOptions): Promise<PendingCommand[]> {
    return [...this.commands.values()]
      .filter((entry) => this.isClaimable(entry, options.claimedAt))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, limit)
      .map((entry) => {
        this.claim(entry, options);
        return this.toPendingCommand(entry);
      });
  }

  async listPending(): Promise<PendingCommand[]> {
    return [...this.commands.values()]
      .filter((entry) => entry.receipt === null)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((entry) => this.toPendingCommand(entry));
  }

  async recordAttempt(commandId: string, attemptedAt: Date): Promise<void> {
    const entry = this.require(commandId);
    if (entry.receipt) return;
    entry.attemptCount += 1;
    entry.lastAttemptAt = new Date(attemptedAt);
    entry.lastError = null;
  }

  async recordAttemptFailure(commandId: string, reason: string, attemptedAt: Date, nextAttemptAt: Date): Promise<void> {
    const entry = this.require(commandId);
    if (entry.receipt) return;
    entry.lastAttemptAt = new Date(attemptedAt);
    entry.lastError = reason;
    entry.nextAttemptAt = new Date(nextAttemptAt);
    entry.leaseOwner = null;
    entry.leaseExpiresAt = null;
  }

  async recordReceipt(receipt: CommandReceipt): Promise<void> {
    const entry = this.require(receipt.commandId);
    if (entry.receipt) return;
    entry.receipt = structuredClone(receipt);
    entry.lastError = receipt.reason ?? null;
    entry.leaseOwner = null;
    entry.leaseExpiresAt = null;
  }

  private isClaimable(entry: StoredCommand, now: Date): boolean {
    return entry.receipt === null
      && entry.nextAttemptAt.getTime() <= now.getTime()
      && (!entry.leaseExpiresAt || entry.leaseExpiresAt.getTime() <= now.getTime());
  }

  private claim(entry: StoredCommand, options: CommandClaimOptions): void {
    entry.leaseOwner = options.workerId;
    entry.leaseExpiresAt = new Date(options.claimedAt.getTime() + options.leaseDurationMs);
  }

  private toPendingCommand(entry: StoredCommand): PendingCommand {
    return {
      command: structuredClone(entry.command),
      attemptCount: entry.attemptCount,
      lastAttemptAt: entry.lastAttemptAt ? new Date(entry.lastAttemptAt) : null,
      lastError: entry.lastError,
    };
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

export class InMemoryMissionEventRepository implements MissionEventRepository {
  private readonly events: MissionEventView[] = [];
  private nextEventId = 0;

  async append(event: NewMissionEvent): Promise<void> {
    this.events.push({
      eventId: `event-${++this.nextEventId}`,
      missionId: event.missionId,
      type: event.type,
      state: event.state,
      robotId: event.robotId,
      commandId: event.commandId,
      message: event.message,
      data: structuredClone(event.data ?? {}),
      occurredAt: event.occurredAt.toISOString(),
    });
  }

  async listByMission(missionId: string): Promise<MissionEventView[]> {
    return this.events
      .filter((event) => event.missionId === missionId)
      .map((event) => structuredClone(event));
  }
}
