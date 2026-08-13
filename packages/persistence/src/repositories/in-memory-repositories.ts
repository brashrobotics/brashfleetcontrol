import type {
  AssignmentDecisionRepository,
  CommandClaimOptions,
  CommandRepository,
  MissionEventRepository,
  MissionRepository,
  MapTopologyRepository,
  NewMissionEvent,
  PendingCommand,
  RepositoryReadOptions,
  RobotRepository,
  TrafficPlanRepository,
} from "@brash/application";
import type {
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
  MissionEventView,
} from "@brash/contracts";
import type {
  MapTopology,
  Mission,
  Robot,
  TrafficPlanSnapshot,
  TrafficReservationSnapshot,
} from "@brash/domain";

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

  async updatePending(command: MissionCommand, updatedAt: Date): Promise<void> {
    const entry = this.require(command.commandId);
    if (entry.receipt) return;
    entry.command = structuredClone(command);
    entry.nextAttemptAt = new Date(Math.min(entry.nextAttemptAt.getTime(), updatedAt.getTime()));
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

export class InMemoryMapTopologyRepository implements MapTopologyRepository {
  private readonly topologies = new Map<string, MapTopology>();

  constructor(initial: MapTopology[] = []) {
    for (const topology of initial) this.topologies.set(topology.mapId, topology);
  }

  async getById(mapId: string, _options?: RepositoryReadOptions): Promise<MapTopology | null> {
    return this.topologies.get(mapId) ?? null;
  }

  async list(): Promise<MapTopology[]> {
    return [...this.topologies.values()].sort((left, right) => left.mapId.localeCompare(right.mapId));
  }

  async save(topology: MapTopology): Promise<void> {
    this.topologies.set(topology.mapId, topology);
  }
}

export class InMemoryTrafficPlanRepository implements TrafficPlanRepository {
  private readonly plans = new Map<string, TrafficPlanSnapshot>();

  async getByMission(missionId: string): Promise<TrafficPlanSnapshot | null> {
    const plan = [...this.plans.values()].find((candidate) => candidate.missionId === missionId);
    return plan ? cloneTrafficPlan(plan) : null;
  }

  async listByMap(mapId: string): Promise<TrafficPlanSnapshot[]> {
    return [...this.plans.values()]
      .filter((plan) => plan.mapId === mapId)
      .sort((left, right) => left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime() || left.routeId.localeCompare(right.routeId))
      .map(cloneTrafficPlan);
  }

  async listActiveReservations(
    mapId: string,
    after: Date,
    excludeMissionId?: string,
  ): Promise<TrafficReservationSnapshot[]> {
    return [...this.plans.values()]
      .flatMap((plan) => plan.reservations)
      .filter((reservation) => reservation.mapId === mapId
        && reservation.state === "ACTIVE"
        && reservation.endsAt.getTime() > after.getTime()
        && reservation.missionId !== excludeMissionId)
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.reservationId.localeCompare(right.reservationId))
      .map(cloneTrafficReservation);
  }

  async save(plan: TrafficPlanSnapshot): Promise<void> {
    this.plans.set(plan.routeId, cloneTrafficPlan(plan));
  }

  async releaseByMission(missionId: string, releasedAt: Date): Promise<TrafficPlanSnapshot | null> {
    const entry = [...this.plans.entries()].find(([, plan]) => plan.missionId === missionId);
    if (!entry) return null;
    const [routeId, plan] = entry;
    if (plan.status === "RELEASED") return cloneTrafficPlan(plan);
    const released: TrafficPlanSnapshot = {
      ...cloneTrafficPlan(plan),
      status: "RELEASED",
      releasedAt: new Date(releasedAt),
      reservations: plan.reservations.map((reservation) => ({
        ...cloneTrafficReservation(reservation),
        state: "RELEASED",
        releasedAt: new Date(releasedAt),
      })),
    };
    this.plans.set(routeId, released);
    return cloneTrafficPlan(released);
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

function cloneTrafficReservation(reservation: TrafficReservationSnapshot): TrafficReservationSnapshot {
  return {
    ...reservation,
    startsAt: new Date(reservation.startsAt),
    endsAt: new Date(reservation.endsAt),
    releasedAt: reservation.releasedAt ? new Date(reservation.releasedAt) : null,
  };
}

function cloneTrafficPlan(plan: TrafficPlanSnapshot): TrafficPlanSnapshot {
  return {
    ...plan,
    requestedStartAt: new Date(plan.requestedStartAt),
    scheduledStartAt: new Date(plan.scheduledStartAt),
    expectedArrivalAt: new Date(plan.expectedArrivalAt),
    segments: plan.segments.map((segment) => ({
      ...segment,
      enterAt: new Date(segment.enterAt),
      exitAt: new Date(segment.exitAt),
    })),
    reservations: plan.reservations.map(cloneTrafficReservation),
    plannedAt: new Date(plan.plannedAt),
    releasedAt: plan.releasedAt ? new Date(plan.releasedAt) : null,
  };
}
