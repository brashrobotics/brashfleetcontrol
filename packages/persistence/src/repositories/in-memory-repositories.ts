import type {
  AssignmentDecisionRepository,
  AuditEventFilter,
  AuditEventRecord,
  AuditRepository,
  AlarmRecord,
  AlarmRepository,
  CommandClaimOptions,
  CommandRepository,
  CapabilityProfileRecord,
  CapabilityProfileRepository,
  InfrastructureResourceRecord,
  InfrastructureResourceRepository,
  IntegrationEventClaimOptions,
  IntegrationEventFilter,
  IntegrationEventRecord,
  IntegrationEventRepository,
  LeaderLeaseRecord,
  LeaderLeaseRepository,
  MissionEventRepository,
  MissionQueueClaimOptions,
  MissionQueueEntry,
  MissionQueueOutcome,
  MissionQueueRepository,
  MissionRepository,
  MapTopologyRepository,
  MapVersionRecord,
  NewMissionEvent,
  PendingCommand,
  RepositoryReadOptions,
  RobotRepository,
  RobotOperatorControlRecord,
  RaiseAlarmInput,
  TrafficPlanRepository,
  TrafficRouteRevisionRecord,
  TrafficRestrictionRecord,
  TrafficRestrictionRepository,
  WorkflowClaimOptions,
  WorkflowRecord,
  WorkflowRepository,
  WorkflowTemplateRecord,
  WorkflowTemplateRepository,
  WorkflowResourceReservationRecord,
  WorkflowResourceReservationRepository,
  WorkflowStepRecord,
  WorkOrderClaimOptions,
  WorkOrderRecord,
  WorkOrderRepository,
} from "@brash/application";
import type {
  AlarmStatus,
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
  MissionEventView,
  InfrastructureResourceStatus,
} from "@brash/contracts";

export class InMemoryAlarmRepository implements AlarmRepository {
  private readonly alarms = new Map<string, AlarmRecord>();
  private nextId = 0;

  async raise(input: RaiseAlarmInput): Promise<AlarmRecord> {
    const existing = [...this.alarms.values()].find((alarm) => alarm.fingerprint === input.fingerprint && alarm.status !== "RESOLVED");
    if (existing) {
      existing.code = input.code;
      existing.severity = input.severity;
      existing.title = input.title;
      existing.message = input.message;
      existing.occurrenceCount += 1;
      existing.lastOccurredAt = new Date(input.occurredAt);
      return cloneAlarm(existing);
    }
    const alarm: AlarmRecord = {
      alarmId: `ALARM-${String(++this.nextId).padStart(4, "0")}`,
      fingerprint: input.fingerprint,
      code: input.code,
      severity: input.severity,
      status: "OPEN",
      title: input.title,
      message: input.message,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurrenceCount: 1,
      firstOccurredAt: new Date(input.occurredAt),
      lastOccurredAt: new Date(input.occurredAt),
      acknowledgedAt: null,
      acknowledgedBy: null,
      acknowledgementNote: null,
      resolvedAt: null,
    };
    this.alarms.set(alarm.alarmId, alarm);
    return cloneAlarm(alarm);
  }

  async getById(alarmId: string): Promise<AlarmRecord | null> {
    const alarm = this.alarms.get(alarmId);
    return alarm ? cloneAlarm(alarm) : null;
  }

  async listActive(): Promise<AlarmRecord[]> {
    return [...this.alarms.values()]
      .filter((alarm) => alarm.status !== "RESOLVED")
      .sort((left, right) => severityRank(right.severity) - severityRank(left.severity)
        || right.lastOccurredAt.getTime() - left.lastOccurredAt.getTime())
      .map(cloneAlarm);
  }

  async acknowledge(alarmId: string, operatorId: string, note: string | null, at: Date): Promise<AlarmRecord | null> {
    const alarm = this.alarms.get(alarmId);
    if (!alarm || alarm.status === "RESOLVED") return null;
    alarm.status = "ACKNOWLEDGED";
    alarm.acknowledgedAt = new Date(at);
    alarm.acknowledgedBy = operatorId;
    alarm.acknowledgementNote = note;
    return cloneAlarm(alarm);
  }

  async resolveByFingerprint(fingerprint: string, at: Date): Promise<AlarmRecord | null> {
    const alarm = [...this.alarms.values()].find((entry) => entry.fingerprint === fingerprint && entry.status !== "RESOLVED");
    if (!alarm) return null;
    alarm.status = "RESOLVED";
    alarm.resolvedAt = new Date(at);
    return cloneAlarm(alarm);
  }
}

function cloneAlarm(alarm: AlarmRecord): AlarmRecord {
  return {
    ...alarm,
    firstOccurredAt: new Date(alarm.firstOccurredAt),
    lastOccurredAt: new Date(alarm.lastOccurredAt),
    acknowledgedAt: alarm.acknowledgedAt ? new Date(alarm.acknowledgedAt) : null,
    resolvedAt: alarm.resolvedAt ? new Date(alarm.resolvedAt) : null,
  };
}

function severityRank(severity: "INFO" | "WARNING" | "CRITICAL"): number {
  return ({ INFO: 1, WARNING: 2, CRITICAL: 3 })[severity];
}

export class InMemoryTrafficRestrictionRepository implements TrafficRestrictionRepository {
  private readonly restrictions = new Map<string, TrafficRestrictionRecord>();
  private nextId = 0;

  async create(mapId: string, resourceId: string, reason: string, operatorId: string, at: Date): Promise<TrafficRestrictionRecord> {
    const duplicate = [...this.restrictions.values()].find((entry) => entry.mapId === mapId && entry.resourceId === resourceId && entry.status === "ACTIVE");
    if (duplicate) return cloneRestriction(duplicate);
    const restriction: TrafficRestrictionRecord = {
      restrictionId: `RESTRICTION-${String(++this.nextId).padStart(4, "0")}`,
      mapId, resourceId, reason, status: "ACTIVE", createdBy: operatorId,
      createdAt: new Date(at), clearedBy: null, clearedAt: null,
    };
    this.restrictions.set(restriction.restrictionId, restriction);
    return cloneRestriction(restriction);
  }

  async listActive(mapId: string): Promise<TrafficRestrictionRecord[]> {
    return [...this.restrictions.values()]
      .filter((entry) => entry.mapId === mapId && entry.status === "ACTIVE")
      .sort((left, right) => left.resourceId.localeCompare(right.resourceId))
      .map(cloneRestriction);
  }

  async clear(restrictionId: string, operatorId: string, at: Date): Promise<TrafficRestrictionRecord | null> {
    const restriction = this.restrictions.get(restrictionId);
    if (!restriction || restriction.status === "CLEARED") return null;
    restriction.status = "CLEARED";
    restriction.clearedBy = operatorId;
    restriction.clearedAt = new Date(at);
    return cloneRestriction(restriction);
  }
}

function cloneRestriction(record: TrafficRestrictionRecord): TrafficRestrictionRecord {
  return { ...record, createdAt: new Date(record.createdAt), clearedAt: record.clearedAt ? new Date(record.clearedAt) : null };
}
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

interface StoredMissionQueueEntry {
  missionId: string;
  basePriority: number;
  attemptCount: number;
  enqueuedAt: Date;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
}

export class InMemoryMissionQueueRepository implements MissionQueueRepository {
  private readonly entries = new Map<string, StoredMissionQueueEntry>();

  async enqueue(missionId: string, priority: number, enqueuedAt: Date): Promise<void> {
    const existing = this.entries.get(missionId);
    if (existing) {
      existing.basePriority = priority;
      existing.nextAttemptAt = new Date(Math.min(existing.nextAttemptAt.getTime(), enqueuedAt.getTime()));
      return;
    }
    this.entries.set(missionId, {
      missionId,
      basePriority: priority,
      attemptCount: 0,
      enqueuedAt: new Date(enqueuedAt),
      nextAttemptAt: new Date(enqueuedAt),
      lastAttemptAt: null,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  async claimDue(limit: number, options: MissionQueueClaimOptions): Promise<MissionQueueEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.nextAttemptAt.getTime() <= options.claimedAt.getTime()
        && (!entry.leaseExpiresAt || entry.leaseExpiresAt.getTime() <= options.claimedAt.getTime()))
      .sort((left, right) => this.effectivePriority(right, options.claimedAt, options.agingIntervalMs)
        - this.effectivePriority(left, options.claimedAt, options.agingIntervalMs)
        || left.enqueuedAt.getTime() - right.enqueuedAt.getTime()
        || left.missionId.localeCompare(right.missionId))
      .slice(0, limit)
      .map((entry) => {
        entry.attemptCount += 1;
        entry.lastAttemptAt = new Date(options.claimedAt);
        entry.leaseOwner = options.workerId;
        entry.leaseExpiresAt = new Date(options.claimedAt.getTime() + options.leaseDurationMs);
        return this.toView(entry, options.claimedAt, options.agingIntervalMs);
      });
  }

  async listPending(now: Date, agingIntervalMs: number): Promise<MissionQueueEntry[]> {
    return [...this.entries.values()]
      .map((entry) => this.toView(entry, now, agingIntervalMs))
      .sort((left, right) => right.effectivePriority - left.effectivePriority
        || left.enqueuedAt.getTime() - right.enqueuedAt.getTime()
        || left.missionId.localeCompare(right.missionId));
  }

  async defer(missionId: string, attemptedAt: Date, nextAttemptAt: Date, reason: string): Promise<void> {
    const entry = this.entries.get(missionId);
    if (!entry) return;
    entry.lastAttemptAt = new Date(attemptedAt);
    entry.nextAttemptAt = new Date(nextAttemptAt);
    entry.lastError = reason;
    entry.leaseOwner = null;
    entry.leaseExpiresAt = null;
  }

  async complete(missionId: string, _outcome: MissionQueueOutcome, _completedAt: Date): Promise<void> {
    this.entries.delete(missionId);
  }

  private effectivePriority(entry: StoredMissionQueueEntry, now: Date, agingIntervalMs: number): number {
    const ageMs = Math.max(0, now.getTime() - entry.enqueuedAt.getTime());
    return Math.min(100, entry.basePriority + Math.floor(ageMs / agingIntervalMs));
  }

  private toView(entry: StoredMissionQueueEntry, now: Date, agingIntervalMs: number): MissionQueueEntry {
    return {
      missionId: entry.missionId,
      basePriority: entry.basePriority,
      effectivePriority: this.effectivePriority(entry, now, agingIntervalMs),
      attemptCount: entry.attemptCount,
      enqueuedAt: new Date(entry.enqueuedAt),
      nextAttemptAt: new Date(entry.nextAttemptAt),
      lastAttemptAt: entry.lastAttemptAt ? new Date(entry.lastAttemptAt) : null,
      lastError: entry.lastError,
      leaseOwner: entry.leaseOwner,
      leaseExpiresAt: entry.leaseExpiresAt ? new Date(entry.leaseExpiresAt) : null,
    };
  }
}

export class InMemoryRobotRepository implements RobotRepository {
  private readonly robots = new Map<string, Robot>();
  private readonly controls = new Map<string, RobotOperatorControlRecord>();

  async getById(robotId: string, _options?: RepositoryReadOptions): Promise<Robot | null> {
    return this.robots.get(robotId) ?? null;
  }

  async list(_options?: RepositoryReadOptions): Promise<Robot[]> {
    return [...this.robots.values()].sort((left, right) => left.robotId.localeCompare(right.robotId));
  }

  async save(robot: Robot): Promise<void> {
    this.robots.set(robot.robotId, robot);
  }

  async getOperatorControl(robotId: string): Promise<RobotOperatorControlRecord | null> {
    const control = this.controls.get(robotId);
    return control ? cloneRobotOperatorControl(control) : null;
  }

  async listOperatorControls(activeOnly = false): Promise<RobotOperatorControlRecord[]> {
    return [...this.controls.values()]
      .filter((control) => !activeOnly || control.status === "QUARANTINED")
      .sort((left, right) => right.quarantinedAt.getTime() - left.quarantinedAt.getTime() || left.robotId.localeCompare(right.robotId))
      .map(cloneRobotOperatorControl);
  }

  async quarantine(record: RobotOperatorControlRecord): Promise<void> {
    this.controls.set(record.robotId, cloneRobotOperatorControl(record));
  }

  async clearQuarantine(robotId: string, operatorId: string, inspectionReference: string, at: Date): Promise<RobotOperatorControlRecord | null> {
    const control = this.controls.get(robotId);
    if (!control || control.status !== "QUARANTINED") return null;
    control.status = "CLEARED";
    control.clearedBy = operatorId;
    control.clearedAt = new Date(at);
    control.inspectionReference = inspectionReference;
    return cloneRobotOperatorControl(control);
  }
}

export class InMemoryCapabilityProfileRepository implements CapabilityProfileRepository {
  private readonly profiles = new Map<string, CapabilityProfileRecord>();

  async create(profile: CapabilityProfileRecord): Promise<void> {
    if ([...this.profiles.values()].some((entry) => entry.vendor === profile.vendor && entry.model === profile.model && entry.version === profile.version)) throw new Error(`Capability profile ${profile.vendor}/${profile.model}@${profile.version} already exists.`);
    this.profiles.set(profile.profileId, cloneCapabilityProfile(profile));
  }

  async getById(profileId: string): Promise<CapabilityProfileRecord | null> {
    const profile = this.profiles.get(profileId);
    return profile ? cloneCapabilityProfile(profile) : null;
  }

  async list(): Promise<CapabilityProfileRecord[]> {
    return [...this.profiles.values()].sort((left, right) => left.vendor.localeCompare(right.vendor) || left.model.localeCompare(right.model) || right.version - left.version).map(cloneCapabilityProfile);
  }

  async publish(profileId: string, operatorId: string, at: Date): Promise<CapabilityProfileRecord | null> {
    const profile = this.profiles.get(profileId);
    if (!profile || profile.status !== "DRAFT") return null;
    for (const entry of this.profiles.values()) {
      if (entry.vendor === profile.vendor && entry.model === profile.model && entry.status === "PUBLISHED") return null;
    }
    profile.status = "PUBLISHED";
    profile.publishedBy = operatorId;
    profile.publishedAt = new Date(at);
    return cloneCapabilityProfile(profile);
  }

  async retire(profileId: string, operatorId: string, at: Date): Promise<CapabilityProfileRecord | null> {
    const profile = this.profiles.get(profileId);
    if (!profile || profile.status === "RETIRED") return null;
    profile.status = "RETIRED";
    profile.retiredBy = operatorId;
    profile.retiredAt = new Date(at);
    return cloneCapabilityProfile(profile);
  }
}

function cloneCapabilityProfile(profile: CapabilityProfileRecord): CapabilityProfileRecord {
  return { ...profile, actions: [...profile.actions], allowedZones: [...profile.allowedZones], dimensionsMeters: { ...profile.dimensionsMeters }, supportedFloorTypes: [...profile.supportedFloorTypes], attachments: [...profile.attachments], createdAt: new Date(profile.createdAt), publishedAt: profile.publishedAt ? new Date(profile.publishedAt) : null, retiredAt: profile.retiredAt ? new Date(profile.retiredAt) : null };
}

interface StoredCommand extends PendingCommand {
  createdAt: Date;
  receipt: CommandReceipt | null;
  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  cancelled: boolean;
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
      cancelled: false,
    });
  }

  async updatePending(command: MissionCommand, updatedAt: Date): Promise<void> {
    const entry = this.require(command.commandId);
    if (entry.receipt || entry.cancelled) return;
    entry.command = structuredClone(command);
    entry.nextAttemptAt = new Date(Math.min(entry.nextAttemptAt.getTime(), updatedAt.getTime()));
  }

  async deferPendingByMission(missionId: string, nextAttemptAt: Date, reason: string): Promise<void> {
    for (const entry of this.commands.values()) {
      if (entry.command.missionId !== missionId || entry.receipt || entry.cancelled) continue;
      entry.nextAttemptAt = new Date(nextAttemptAt);
      entry.lastError = reason;
      entry.leaseOwner = null;
      entry.leaseExpiresAt = null;
    }
  }

  async resumePendingByMission(missionId: string, at: Date): Promise<void> {
    for (const entry of this.commands.values()) {
      if (entry.command.missionId !== missionId || entry.receipt || entry.cancelled) continue;
      entry.nextAttemptAt = new Date(at);
      entry.lastError = null;
      entry.leaseOwner = null;
      entry.leaseExpiresAt = null;
    }
  }

  async cancelPendingByMission(missionId: string, at: Date, reason: string): Promise<void> {
    for (const entry of this.commands.values()) {
      if (entry.command.missionId !== missionId || entry.receipt || entry.cancelled) continue;
      entry.cancelled = true;
      entry.lastAttemptAt = new Date(at);
      entry.lastError = reason;
      entry.leaseOwner = null;
      entry.leaseExpiresAt = null;
    }
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
      && !entry.cancelled
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
  private readonly versions = new Map<string, MapVersionRecord>();

  constructor(initial: MapTopology[] = []) {
    for (const topology of initial) {
      this.versions.set(topology.mapId, {
        topology,
        familyId: familyIdFor(topology.mapId),
        status: "PUBLISHED",
        createdBy: "system-bootstrap",
        createdAt: new Date(0),
        publishedBy: "system-bootstrap",
        publishedAt: new Date(0),
        retiredBy: null,
        retiredAt: null,
      });
    }
  }

  async getById(mapId: string, _options?: RepositoryReadOptions): Promise<MapTopology | null> {
    return this.versions.get(mapId)?.topology ?? null;
  }

  async list(): Promise<MapTopology[]> {
    return [...this.versions.values()].filter((record) => record.status === "PUBLISHED").map((record) => record.topology).sort((left, right) => left.mapId.localeCompare(right.mapId));
  }

  async save(topology: MapTopology): Promise<void> {
    const existing = this.versions.get(topology.mapId);
    if (existing) {
      if (JSON.stringify(existing.topology.snapshot()) !== JSON.stringify(topology.snapshot())) throw new Error(`Published map ${topology.mapId} is immutable; create a new revision.`);
      return;
    }
    this.versions.set(topology.mapId, {
      topology,
      familyId: familyIdFor(topology.mapId),
      status: "PUBLISHED",
      createdBy: "system-bootstrap",
      createdAt: new Date(),
      publishedBy: "system-bootstrap",
      publishedAt: new Date(),
      retiredBy: null,
      retiredAt: null,
    });
  }

  async getVersion(mapId: string, _options?: RepositoryReadOptions): Promise<MapVersionRecord | null> {
    const record = this.versions.get(mapId);
    return record ? cloneMapVersion(record) : null;
  }

  async listVersions(familyId?: string): Promise<MapVersionRecord[]> {
    return [...this.versions.values()]
      .filter((record) => !familyId || record.familyId === familyId)
      .sort((left, right) => left.familyId.localeCompare(right.familyId) || left.topology.revision - right.topology.revision)
      .map(cloneMapVersion);
  }

  async createDraft(topology: MapTopology, familyId: string, operatorId: string, at: Date): Promise<MapVersionRecord> {
    if (this.versions.has(topology.mapId) || [...this.versions.values()].some((record) => record.familyId === familyId && record.topology.revision === topology.revision)) {
      throw new Error(`Map revision ${familyId}@${topology.revision} already exists.`);
    }
    const record: MapVersionRecord = {
      topology, familyId, status: "DRAFT", createdBy: operatorId, createdAt: new Date(at),
      publishedBy: null, publishedAt: null, retiredBy: null, retiredAt: null,
    };
    this.versions.set(topology.mapId, record);
    return cloneMapVersion(record);
  }

  async publish(mapId: string, operatorId: string, at: Date): Promise<MapVersionRecord | null> {
    const record = this.versions.get(mapId);
    if (!record || record.status !== "DRAFT") return null;
    record.status = "PUBLISHED";
    record.publishedBy = operatorId;
    record.publishedAt = new Date(at);
    return cloneMapVersion(record);
  }

  async retire(mapId: string, operatorId: string, at: Date): Promise<MapVersionRecord | null> {
    const record = this.versions.get(mapId);
    if (!record || record.status !== "PUBLISHED") return null;
    record.status = "RETIRED";
    record.retiredBy = operatorId;
    record.retiredAt = new Date(at);
    return cloneMapVersion(record);
  }
}

export class InMemoryInfrastructureResourceRepository implements InfrastructureResourceRepository {
  private readonly resources = new Map<string, InfrastructureResourceRecord>();

  constructor(initial: InfrastructureResourceRecord[] = []) {
    for (const resource of initial) this.resources.set(resource.resourceId, cloneInfrastructureResource(resource));
  }

  async getById(resourceId: string, _options?: RepositoryReadOptions): Promise<InfrastructureResourceRecord | null> {
    const resource = this.resources.get(resourceId);
    return resource ? cloneInfrastructureResource(resource) : null;
  }

  async listByMap(mapId: string): Promise<InfrastructureResourceRecord[]> {
    return [...this.resources.values()].filter((resource) => resource.mapId === mapId)
      .sort((left, right) => left.resourceId.localeCompare(right.resourceId)).map(cloneInfrastructureResource);
  }

  async create(resource: InfrastructureResourceRecord): Promise<InfrastructureResourceRecord> {
    if (this.resources.has(resource.resourceId)) throw new Error(`Infrastructure resource ${resource.resourceId} already exists.`);
    this.resources.set(resource.resourceId, cloneInfrastructureResource(resource));
    return cloneInfrastructureResource(resource);
  }

  async updateStatus(resourceId: string, status: InfrastructureResourceStatus, reason: string, operatorId: string, at: Date): Promise<InfrastructureResourceRecord | null> {
    const resource = this.resources.get(resourceId);
    if (!resource) return null;
    resource.status = status;
    resource.statusReason = reason;
    resource.updatedBy = operatorId;
    resource.updatedAt = new Date(at);
    return cloneInfrastructureResource(resource);
  }
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, WorkflowRecord>();
  private readonly steps = new Map<string, WorkflowStepRecord>();

  async findByExternalReference(externalReference: string): Promise<WorkflowRecord | null> {
    const workflow = [...this.workflows.values()].find((candidate) => candidate.externalReference === externalReference);
    return workflow ? cloneWorkflow(workflow) : null;
  }

  async create(workflow: WorkflowRecord, steps: WorkflowStepRecord[]): Promise<void> {
    if (this.workflows.has(workflow.workflowId)) throw new Error(`Workflow ${workflow.workflowId} already exists.`);
    if (workflow.externalReference && [...this.workflows.values()].some((candidate) => candidate.externalReference === workflow.externalReference)) {
      throw new Error(`Workflow external reference ${workflow.externalReference} already exists.`);
    }
    this.workflows.set(workflow.workflowId, cloneWorkflow(workflow));
    for (const step of steps) this.steps.set(workflowStepKey(step.workflowId, step.definition.stepId), cloneWorkflowStep(step));
  }

  async getById(workflowId: string): Promise<{ workflow: WorkflowRecord; steps: WorkflowStepRecord[] } | null> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;
    return {
      workflow: cloneWorkflow(workflow),
      steps: [...this.steps.values()].filter((step) => step.workflowId === workflowId)
        .sort((left, right) => left.definition.stepId.localeCompare(right.definition.stepId)).map(cloneWorkflowStep),
    };
  }

  async list(): Promise<WorkflowRecord[]> {
    return [...this.workflows.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).map(cloneWorkflow);
  }

  async claimRunnable(limit: number, options: WorkflowClaimOptions): Promise<WorkflowStepRecord[]> {
    const runnable = [...this.steps.values()].filter((step) => {
      const workflow = this.workflows.get(step.workflowId);
      if (!workflow || !["PENDING", "RUNNING", "CANCELLING"].includes(workflow.status)) return false;
      if (!["PENDING", "WAITING_RETRY", "RUNNING"].includes(step.status)) return false;
      if (step.nextAttemptAt.getTime() > options.claimedAt.getTime()) return false;
      if (step.leaseExpiresAt && step.leaseExpiresAt.getTime() > options.claimedAt.getTime()) return false;
      return step.definition.dependsOn.every((dependency) => this.steps.get(workflowStepKey(step.workflowId, dependency))?.status === "SUCCEEDED");
    }).sort((left, right) => Number(right.status === "RUNNING") - Number(left.status === "RUNNING")
      || left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime()
      || left.workflowId.localeCompare(right.workflowId) || left.definition.stepId.localeCompare(right.definition.stepId)).slice(0, limit);
    for (const step of runnable) {
      step.leaseOwner = options.workerId;
      step.leaseExpiresAt = new Date(options.claimedAt.getTime() + options.leaseDurationMs);
    }
    return runnable.map(cloneWorkflowStep);
  }

  async saveStep(step: WorkflowStepRecord): Promise<void> {
    this.steps.set(workflowStepKey(step.workflowId, step.definition.stepId), cloneWorkflowStep(step));
  }

  async saveWorkflow(workflow: WorkflowRecord): Promise<void> {
    this.workflows.set(workflow.workflowId, cloneWorkflow(workflow));
  }
}

export class InMemoryWorkflowTemplateRepository implements WorkflowTemplateRepository {
  private readonly templates = new Map<string, WorkflowTemplateRecord>();

  async create(template: WorkflowTemplateRecord): Promise<void> {
    if (this.templates.has(template.templateId) || [...this.templates.values()].some((entry) => entry.templateKey === template.templateKey && entry.version === template.version)) {
      throw new Error(`Workflow template ${template.templateKey}@${template.version} already exists.`);
    }
    this.templates.set(template.templateId, cloneWorkflowTemplate(template));
  }

  async getById(templateId: string): Promise<WorkflowTemplateRecord | null> {
    const template = this.templates.get(templateId);
    return template ? cloneWorkflowTemplate(template) : null;
  }

  async list(templateKey?: string): Promise<WorkflowTemplateRecord[]> {
    return [...this.templates.values()].filter((entry) => !templateKey || entry.templateKey === templateKey)
      .sort((left, right) => left.templateKey.localeCompare(right.templateKey) || right.version - left.version)
      .map(cloneWorkflowTemplate);
  }

  async publish(templateId: string, operatorId: string, at: Date): Promise<WorkflowTemplateRecord | null> {
    const template = this.templates.get(templateId);
    if (!template || template.status !== "DRAFT") return null;
    if ([...this.templates.values()].some((entry) => entry.templateKey === template.templateKey && entry.status === "PUBLISHED")) {
      throw new Error(`Workflow template ${template.templateKey} already has a published version.`);
    }
    template.status = "PUBLISHED";
    template.publishedBy = operatorId;
    template.publishedAt = new Date(at);
    return cloneWorkflowTemplate(template);
  }

  async retire(templateId: string, operatorId: string, at: Date): Promise<WorkflowTemplateRecord | null> {
    const template = this.templates.get(templateId);
    if (!template || template.status !== "PUBLISHED") return null;
    template.status = "RETIRED";
    template.retiredBy = operatorId;
    template.retiredAt = new Date(at);
    return cloneWorkflowTemplate(template);
  }
}

export class InMemoryWorkflowResourceReservationRepository implements WorkflowResourceReservationRepository {
  private readonly reservations = new Map<string, WorkflowResourceReservationRecord>();

  async getActiveByStep(workflowId: string, stepId: string): Promise<WorkflowResourceReservationRecord | null> {
    const reservation = [...this.reservations.values()].find((candidate) => candidate.workflowId === workflowId && candidate.stepId === stepId && candidate.state === "ACTIVE");
    return reservation ? cloneWorkflowResourceReservation(reservation) : null;
  }

  async tryReserve(reservation: WorkflowResourceReservationRecord): Promise<WorkflowResourceReservationRecord | null> {
    const conflict = [...this.reservations.values()].some((existing) => existing.state === "ACTIVE"
      && existing.resourceId === reservation.resourceId
      && existing.startsAt.getTime() < reservation.endsAt.getTime()
      && reservation.startsAt.getTime() < existing.endsAt.getTime());
    if (conflict) return null;
    this.reservations.set(reservation.reservationId, cloneWorkflowResourceReservation(reservation));
    return cloneWorkflowResourceReservation(reservation);
  }

  async release(reservationId: string, at: Date): Promise<WorkflowResourceReservationRecord | null> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return null;
    if (reservation.state === "ACTIVE") {
      reservation.state = "RELEASED";
      reservation.releasedAt = new Date(at);
    }
    return cloneWorkflowResourceReservation(reservation);
  }
}

export class InMemoryWorkOrderRepository implements WorkOrderRepository {
  private readonly workOrders = new Map<string, WorkOrderRecord>();

  async findByExternalReference(externalReference: string): Promise<WorkOrderRecord | null> {
    const record = [...this.workOrders.values()].find((candidate) => candidate.request.externalReference === externalReference);
    return record ? cloneWorkOrder(record) : null;
  }

  async getById(workOrderId: string): Promise<WorkOrderRecord | null> {
    const record = this.workOrders.get(workOrderId);
    return record ? cloneWorkOrder(record) : null;
  }

  async list(): Promise<WorkOrderRecord[]> {
    return [...this.workOrders.values()].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).map(cloneWorkOrder);
  }

  async create(workOrder: WorkOrderRecord): Promise<void> {
    if (this.workOrders.has(workOrder.workOrderId)) throw new Error(`Work order ${workOrder.workOrderId} already exists.`);
    if (workOrder.request.externalReference && [...this.workOrders.values()].some((candidate) => candidate.request.externalReference === workOrder.request.externalReference)) {
      throw new Error(`Work order external reference ${workOrder.request.externalReference} already exists.`);
    }
    this.workOrders.set(workOrder.workOrderId, cloneWorkOrder(workOrder));
  }

  async save(workOrder: WorkOrderRecord): Promise<void> {
    this.workOrders.set(workOrder.workOrderId, cloneWorkOrder(workOrder));
  }

  async claimPending(limit: number, options: WorkOrderClaimOptions): Promise<WorkOrderRecord[]> {
    const records = [...this.workOrders.values()].filter((record) => record.status === "PENDING"
      && record.nextAttemptAt.getTime() <= options.claimedAt.getTime()
      && (!record.leaseExpiresAt || record.leaseExpiresAt.getTime() <= options.claimedAt.getTime()))
      .sort((left, right) => right.request.priority - left.request.priority
        || left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime()
        || left.workOrderId.localeCompare(right.workOrderId)).slice(0, limit);
    for (const record of records) {
      record.leaseOwner = options.workerId;
      record.leaseExpiresAt = new Date(options.claimedAt.getTime() + options.leaseDurationMs);
    }
    return records.map(cloneWorkOrder);
  }
}

export class InMemoryIntegrationEventRepository implements IntegrationEventRepository {
  private readonly events = new Map<string, IntegrationEventRecord>();

  async enqueue(event: IntegrationEventRecord): Promise<void> {
    if ([...this.events.values()].some((candidate) => candidate.idempotencyKey === event.idempotencyKey)) return;
    this.events.set(event.eventId, cloneIntegrationEvent(event));
  }

  async getById(eventId: string): Promise<IntegrationEventRecord | null> {
    const event = this.events.get(eventId);
    return event ? cloneIntegrationEvent(event) : null;
  }

  async list(filter: IntegrationEventFilter): Promise<IntegrationEventRecord[]> {
    return [...this.events.values()]
      .filter((event) => !filter.status || event.status === filter.status)
      .filter((event) => !filter.aggregateType || event.aggregateType === filter.aggregateType)
      .filter((event) => !filter.aggregateId || event.aggregateId === filter.aggregateId)
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || left.eventId.localeCompare(right.eventId))
      .slice(0, filter.limit)
      .map(cloneIntegrationEvent);
  }

  async claimDue(limit: number, options: IntegrationEventClaimOptions): Promise<IntegrationEventRecord[]> {
    const due = [...this.events.values()]
      .filter((event) => event.status === "PENDING" && event.nextAttemptAt.getTime() <= options.claimedAt.getTime())
      .filter((event) => !event.leaseExpiresAt || event.leaseExpiresAt.getTime() <= options.claimedAt.getTime())
      .sort((left, right) => left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime() || left.occurredAt.getTime() - right.occurredAt.getTime())
      .slice(0, limit);
    for (const event of due) {
      event.leaseOwner = options.workerId;
      event.leaseExpiresAt = new Date(options.claimedAt.getTime() + options.leaseDurationMs);
    }
    return due.map(cloneIntegrationEvent);
  }

  async recordDelivered(eventId: string, deliveredAt: Date, responseStatus: number): Promise<IntegrationEventRecord | null> {
    const event = this.events.get(eventId);
    if (!event || event.status !== "PENDING") return null;
    event.status = "DELIVERED";
    event.attemptCount += 1;
    event.lastAttemptAt = new Date(deliveredAt);
    event.deliveredAt = new Date(deliveredAt);
    event.lastError = null;
    event.responseStatus = responseStatus;
    event.leaseOwner = null;
    event.leaseExpiresAt = null;
    return cloneIntegrationEvent(event);
  }

  async recordFailure(eventId: string, attemptedAt: Date, nextAttemptAt: Date, error: string, maxAttempts: number, responseStatus?: number): Promise<IntegrationEventRecord | null> {
    const event = this.events.get(eventId);
    if (!event || event.status !== "PENDING") return null;
    event.attemptCount += 1;
    event.status = event.attemptCount >= maxAttempts ? "DEAD_LETTER" : "PENDING";
    event.lastAttemptAt = new Date(attemptedAt);
    event.nextAttemptAt = new Date(nextAttemptAt);
    event.lastError = error;
    event.responseStatus = responseStatus ?? null;
    event.leaseOwner = null;
    event.leaseExpiresAt = null;
    return cloneIntegrationEvent(event);
  }

  async redrive(eventId: string, at: Date): Promise<IntegrationEventRecord | null> {
    const event = this.events.get(eventId);
    if (!event || event.status !== "DEAD_LETTER") return null;
    event.status = "PENDING";
    event.attemptCount = 0;
    event.nextAttemptAt = new Date(at);
    event.lastError = null;
    event.responseStatus = null;
    event.leaseOwner = null;
    event.leaseExpiresAt = null;
    return cloneIntegrationEvent(event);
  }
}

export class InMemoryLeaderLeaseRepository implements LeaderLeaseRepository {
  private readonly leases = new Map<string, LeaderLeaseRecord>();

  async acquire(resourceName: string, ownerId: string, at: Date, leaseDurationMs: number): Promise<LeaderLeaseRecord | null> {
    const current = this.leases.get(resourceName);
    if (current && current.ownerId !== ownerId && current.expiresAt.getTime() > at.getTime()) return null;
    const ownerChanged = current?.ownerId !== ownerId || (current?.expiresAt.getTime() ?? 0) <= at.getTime();
    const lease: LeaderLeaseRecord = {
      resourceName,
      ownerId,
      fencingToken: current ? current.fencingToken + (ownerChanged ? 1 : 0) : 1,
      acquiredAt: ownerChanged ? new Date(at) : new Date(current!.acquiredAt),
      renewedAt: new Date(at),
      expiresAt: new Date(at.getTime() + leaseDurationMs),
    };
    this.leases.set(resourceName, lease);
    return cloneLeaderLease(lease);
  }

  async get(resourceName: string): Promise<LeaderLeaseRecord | null> {
    const lease = this.leases.get(resourceName);
    return lease ? cloneLeaderLease(lease) : null;
  }

  async validateFence(resourceName: string, ownerId: string, fencingToken: number, at: Date): Promise<boolean> {
    const lease = this.leases.get(resourceName);
    return Boolean(lease && lease.ownerId === ownerId && lease.fencingToken === fencingToken && lease.expiresAt.getTime() > at.getTime());
  }

  async release(resourceName: string, ownerId: string, fencingToken: number, at: Date): Promise<boolean> {
    const lease = this.leases.get(resourceName);
    if (!lease || lease.ownerId !== ownerId || lease.fencingToken !== fencingToken) return false;
    lease.expiresAt = new Date(at);
    lease.renewedAt = new Date(at);
    return true;
  }
}

function cloneMapVersion(record: MapVersionRecord): MapVersionRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
    retiredAt: record.retiredAt ? new Date(record.retiredAt) : null,
  };
}

function cloneInfrastructureResource(record: InfrastructureResourceRecord): InfrastructureResourceRecord {
  return { ...record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}

function cloneWorkflow(record: WorkflowRecord): WorkflowRecord {
  return { ...record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt), completedAt: record.completedAt ? new Date(record.completedAt) : null };
}

function cloneWorkflowTemplate(record: WorkflowTemplateRecord): WorkflowTemplateRecord {
  return {
    ...structuredClone(record),
    createdAt: new Date(record.createdAt),
    publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
    retiredAt: record.retiredAt ? new Date(record.retiredAt) : null,
  };
}

function cloneWorkflowStep(record: WorkflowStepRecord): WorkflowStepRecord {
  return {
    ...record,
    definition: structuredClone(record.definition),
    startedAt: record.startedAt ? new Date(record.startedAt) : null,
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
    nextAttemptAt: new Date(record.nextAttemptAt),
    timeoutAt: record.timeoutAt ? new Date(record.timeoutAt) : null,
    waitUntil: record.waitUntil ? new Date(record.waitUntil) : null,
    leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null,
  };
}

function cloneWorkflowResourceReservation(record: WorkflowResourceReservationRecord): WorkflowResourceReservationRecord {
  return { ...record, startsAt: new Date(record.startsAt), endsAt: new Date(record.endsAt), releasedAt: record.releasedAt ? new Date(record.releasedAt) : null };
}

function workflowStepKey(workflowId: string, stepId: string): string {
  return `${workflowId}:${stepId}`;
}

function familyIdFor(mapId: string): string {
  return mapId.match(/^(.+)@\d+$/)?.[1] ?? mapId;
}

export class InMemoryTrafficPlanRepository implements TrafficPlanRepository {
  private readonly plans = new Map<string, TrafficPlanSnapshot>();
  private readonly revisions = new Map<string, TrafficRouteRevisionRecord>();

  async getByMission(missionId: string): Promise<TrafficPlanSnapshot | null> {
    const plan = [...this.plans.values()].filter((candidate) => candidate.missionId === missionId)
      .sort((left, right) => Number(right.status !== "RELEASED") - Number(left.status !== "RELEASED")
        || (this.revisions.get(right.routeId)?.revision ?? 1) - (this.revisions.get(left.routeId)?.revision ?? 1))[0];
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
        && (reservation.state === "ACTIVE" || reservation.state === "SAFETY_HOLD")
        && reservation.endsAt.getTime() > after.getTime()
        && reservation.missionId !== excludeMissionId)
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.reservationId.localeCompare(right.reservationId))
      .map(cloneTrafficReservation);
  }

  async save(plan: TrafficPlanSnapshot): Promise<void> {
    this.plans.set(plan.routeId, cloneTrafficPlan(plan));
    if (!this.revisions.has(plan.routeId)) this.revisions.set(plan.routeId, {
      missionId: plan.missionId, routeId: plan.routeId, revision: 1,
      supersedesRouteId: null, reason: "Initial route", triggeredBy: "system",
      createdAt: new Date(plan.plannedAt), status: plan.status,
    });
  }

  async replaceActive(plan: TrafficPlanSnapshot, reason: string, triggeredBy: string, at: Date): Promise<TrafficRouteRevisionRecord | null> {
    const current = [...this.plans.values()].find((candidate) => candidate.missionId === plan.missionId && candidate.status === "ACTIVE");
    if (!current) return null;
    const released = cloneTrafficPlan(current);
    released.status = "RELEASED";
    released.releasedAt = new Date(at);
    released.reservations = released.reservations.map((reservation) => ({ ...reservation, state: "RELEASED", releasedAt: new Date(at) }));
    this.plans.set(released.routeId, released);
    const previousRevision = this.revisions.get(current.routeId)?.revision ?? 1;
    const revision: TrafficRouteRevisionRecord = {
      missionId: plan.missionId, routeId: plan.routeId, revision: previousRevision + 1,
      supersedesRouteId: current.routeId, reason, triggeredBy, createdAt: new Date(at), status: plan.status,
    };
    this.plans.set(plan.routeId, cloneTrafficPlan(plan));
    const previousMetadata = this.revisions.get(current.routeId);
    if (previousMetadata) previousMetadata.status = "RELEASED";
    this.revisions.set(plan.routeId, revision);
    return cloneTrafficRouteRevision(revision);
  }

  async listRevisions(missionId: string): Promise<TrafficRouteRevisionRecord[]> {
    return [...this.revisions.values()].filter((revision) => revision.missionId === missionId)
      .sort((left, right) => left.revision - right.revision).map(cloneTrafficRouteRevision);
  }

  async renewLeaseByMission(missionId: string, renewedAt: Date, expiresAt: Date): Promise<TrafficPlanSnapshot | null> {
    const entry = this.currentEntry(missionId);
    if (!entry) return null;
    const [routeId, plan] = entry;
    if (plan.status !== "ACTIVE") return cloneTrafficPlan(plan);
    const renewed = { ...cloneTrafficPlan(plan), lastRenewedAt: new Date(renewedAt), leaseExpiresAt: new Date(expiresAt) };
    this.plans.set(routeId, renewed);
    return cloneTrafficPlan(renewed);
  }

  async placeSafetyHoldByMission(missionId: string, at: Date): Promise<TrafficPlanSnapshot | null> {
    const entry = this.currentEntry(missionId);
    if (!entry) return null;
    const [routeId, plan] = entry;
    if (plan.status === "RELEASED") return cloneTrafficPlan(plan);
    const held = {
      ...cloneTrafficPlan(plan),
      status: "SAFETY_HOLD" as const,
      leaseExpiresAt: new Date(at),
      reservations: plan.reservations.map((reservation) => ({
        ...cloneTrafficReservation(reservation),
        state: "SAFETY_HOLD" as const,
        endsAt: new Date("9999-12-31T23:59:59.999Z"),
      })),
    };
    this.plans.set(routeId, held);
    const revision = this.revisions.get(routeId);
    if (revision) revision.status = "SAFETY_HOLD";
    return cloneTrafficPlan(held);
  }

  async acknowledgeSafetyHoldByMission(missionId: string, renewedAt: Date, expiresAt: Date): Promise<TrafficPlanSnapshot | null> {
    const entry = this.currentEntry(missionId);
    if (!entry) return null;
    const [routeId, plan] = entry;
    if (plan.status !== "SAFETY_HOLD") return cloneTrafficPlan(plan);
    const resumed = {
      ...cloneTrafficPlan(plan),
      status: "SAFETY_HOLD" as const,
      lastRenewedAt: new Date(renewedAt),
      leaseExpiresAt: new Date(expiresAt),
    };
    this.plans.set(routeId, resumed);
    return cloneTrafficPlan(resumed);
  }

  async releaseByMission(missionId: string, releasedAt: Date): Promise<TrafficPlanSnapshot | null> {
    const entry = this.currentEntry(missionId);
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
    const revision = this.revisions.get(routeId);
    if (revision) revision.status = "RELEASED";
    return cloneTrafficPlan(released);
  }

  private currentEntry(missionId: string): [string, TrafficPlanSnapshot] | undefined {
    return [...this.plans.entries()].filter(([, plan]) => plan.missionId === missionId)
      .sort((left, right) => Number(right[1].status !== "RELEASED") - Number(left[1].status !== "RELEASED")
        || (this.revisions.get(right[0])?.revision ?? 1) - (this.revisions.get(left[0])?.revision ?? 1))[0];
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

export class InMemoryAuditRepository implements AuditRepository {
  private readonly events: AuditEventRecord[] = [];

  async append(event: AuditEventRecord): Promise<void> {
    if (this.events.some((candidate) => candidate.auditEventId === event.auditEventId)) {
      throw new Error(`Audit event ${event.auditEventId} already exists.`);
    }
    this.events.push(cloneAuditEvent(event));
  }

  async list(filter: AuditEventFilter): Promise<AuditEventRecord[]> {
    return this.events
      .filter((event) => !filter.actorId || event.actorId === filter.actorId)
      .filter((event) => !filter.targetType || event.targetType === filter.targetType)
      .filter((event) => !filter.targetId || event.targetId === filter.targetId)
      .filter((event) => !filter.correlationId || event.correlationId === filter.correlationId)
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(0, filter.limit)
      .map(cloneAuditEvent);
  }
}

function cloneAuditEvent(event: AuditEventRecord): AuditEventRecord {
  return { ...event, occurredAt: new Date(event.occurredAt), metadata: structuredClone(event.metadata) };
}

function cloneRobotOperatorControl(control: RobotOperatorControlRecord): RobotOperatorControlRecord {
  return {
    ...control,
    quarantinedAt: new Date(control.quarantinedAt),
    clearedAt: control.clearedAt ? new Date(control.clearedAt) : null,
  };
}

function cloneWorkOrder(record: WorkOrderRecord): WorkOrderRecord {
  return {
    ...record,
    request: structuredClone(record.request),
    candidates: structuredClone(record.candidates),
    nextAttemptAt: new Date(record.nextAttemptAt),
    lastAttemptAt: record.lastAttemptAt ? new Date(record.lastAttemptAt) : null,
    leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
  };
}

function cloneIntegrationEvent(record: IntegrationEventRecord): IntegrationEventRecord {
  return {
    ...record,
    payload: structuredClone(record.payload),
    occurredAt: new Date(record.occurredAt),
    nextAttemptAt: new Date(record.nextAttemptAt),
    lastAttemptAt: record.lastAttemptAt ? new Date(record.lastAttemptAt) : null,
    deliveredAt: record.deliveredAt ? new Date(record.deliveredAt) : null,
    leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt) : null,
  };
}

function cloneLeaderLease(record: LeaderLeaseRecord): LeaderLeaseRecord {
  return { ...record, acquiredAt: new Date(record.acquiredAt), renewedAt: new Date(record.renewedAt), expiresAt: new Date(record.expiresAt) };
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
    lastRenewedAt: new Date(plan.lastRenewedAt),
    leaseExpiresAt: new Date(plan.leaseExpiresAt),
    releasedAt: plan.releasedAt ? new Date(plan.releasedAt) : null,
  };
}

function cloneTrafficRouteRevision(revision: TrafficRouteRevisionRecord): TrafficRouteRevisionRecord {
  return { ...revision, createdAt: new Date(revision.createdAt) };
}
