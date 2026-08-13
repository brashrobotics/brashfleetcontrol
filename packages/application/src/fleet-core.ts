import {
  FLEET_SCHEMA_VERSION,
  type AlarmSummaryView,
  type AlarmView,
  type AssignmentDecision,
  type CommandReceipt,
  type CreateInfrastructureResourceRequest,
  type CreateMapVersionRequest,
  type CreateMissionRequest,
  type CreateWorkflowRequest,
  type DispatchQueueView,
  type DispatchResult,
  type FleetRecoveryStatusView,
  type FleetSnapshot,
  type InfrastructureResourceStatus,
  type InfrastructureResourceView,
  type MapTopologyView,
  type MapVersionView,
  type MissionCancellationResult,
  type MissionCommand,
  type MissionEventType,
  type MissionEventView,
  type MissionView,
  type RobotAdapterEvent,
  type TrafficPlanView,
  type TrafficRestrictionView,
  type TrafficScheduleView,
  type WorkflowView,
} from "@brash/contracts";
import {
  DomainError,
  MapTopology,
  Mission,
  Robot,
  RobotLivenessPolicy,
  TrafficScheduler,
  type RobotRegistration,
  type RobotTelemetry,
  type TrafficPlanSnapshot,
} from "@brash/domain";
import type { RobotAdapter, Unsubscribe } from "@brash/robot-adapter-sdk";
import {
  missionToView,
  robotToView,
  topologyToView,
  trafficPlanToView,
  trafficReservationToView,
} from "./mappers.js";
import type { Clock, IdGenerator } from "./ports/platform.js";
import type {
  AssignmentDecisionRepository,
  AlarmRecord,
  AlarmRepository,
  CommandRepository,
  InfrastructureResourceRecord,
  InfrastructureResourceRepository,
  MissionEventRepository,
  MissionQueueEntry,
  MissionQueueRepository,
  MissionRepository,
  MapTopologyRepository,
  MapVersionRecord,
  PendingCommand,
  RobotRepository,
  TrafficPlanRepository,
  TrafficRestrictionRecord,
  TrafficRestrictionRepository,
  TransactionManager,
  WorkflowRecord,
  WorkflowRepository,
  WorkflowResourceReservationRepository,
  WorkflowStepRecord,
} from "./ports/repositories.js";
import { WeightedDispatchPolicy } from "./policies/weighted-dispatch-policy.js";

export interface FleetCoreDependencies {
  alarms: AlarmRepository;
  missions: MissionRepository;
  missionQueue: MissionQueueRepository;
  robots: RobotRepository;
  commands: CommandRepository;
  decisions: AssignmentDecisionRepository;
  events: MissionEventRepository;
  maps: MapTopologyRepository;
  infrastructureResources: InfrastructureResourceRepository;
  traffic: TrafficPlanRepository;
  trafficRestrictions: TrafficRestrictionRepository;
  workflows: WorkflowRepository;
  workflowResourceReservations: WorkflowResourceReservationRepository;
  transactions: TransactionManager;
  clock: Clock;
  ids: IdGenerator;
  adapter: RobotAdapter;
  dispatchPolicy: WeightedDispatchPolicy;
  trafficScheduler: TrafficScheduler;
  livenessPolicy: RobotLivenessPolicy;
  instanceId: string;
}

export interface FleetRecoveryOptions {
  trafficLeaseMs?: number;
  renewLeaseWithinMs?: number;
  dispatchQueueAgingIntervalMs?: number;
  dispatchQueueLeaseMs?: number;
  dispatchRetryBaseMs?: number;
  dispatchRetryMaxMs?: number;
  workflowLeaseMs?: number;
  workflowPollMs?: number;
}

interface AssignmentPreparation {
  mission: Mission;
  decision: AssignmentDecision;
  command: MissionCommand | null;
  route: TrafficPlanSnapshot | null;
}

interface CommandDeliveryResult {
  mission: Mission;
  receipt: CommandReceipt | null;
}

interface CancellationPreparation {
  mission: Mission;
  remoteCommand: { robotId: string; commandId: string } | null;
}

export class FleetCore {
  private readonly dependencies: FleetCoreDependencies;
  private readonly trafficLeaseMs: number;
  private readonly renewLeaseWithinMs: number;
  private readonly dispatchQueueAgingIntervalMs: number;
  private readonly dispatchQueueLeaseMs: number;
  private readonly dispatchRetryBaseMs: number;
  private readonly dispatchRetryMaxMs: number;
  private readonly workflowLeaseMs: number;
  private readonly workflowPollMs: number;
  private readonly managedRobotIds = new Set<string>();
  private unsubscribe: Unsubscribe | null = null;
  private started = false;

  constructor(dependencies: FleetCoreDependencies, recoveryOptions: FleetRecoveryOptions = {}) {
    this.dependencies = dependencies;
    this.trafficLeaseMs = recoveryOptions.trafficLeaseMs ?? 45_000;
    this.renewLeaseWithinMs = recoveryOptions.renewLeaseWithinMs ?? 20_000;
    this.dispatchQueueAgingIntervalMs = recoveryOptions.dispatchQueueAgingIntervalMs ?? 60_000;
    this.dispatchQueueLeaseMs = recoveryOptions.dispatchQueueLeaseMs ?? 30_000;
    this.dispatchRetryBaseMs = recoveryOptions.dispatchRetryBaseMs ?? 1_000;
    this.dispatchRetryMaxMs = recoveryOptions.dispatchRetryMaxMs ?? 60_000;
    this.workflowLeaseMs = recoveryOptions.workflowLeaseMs ?? 30_000;
    this.workflowPollMs = recoveryOptions.workflowPollMs ?? 1_000;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.dependencies.adapter.connect();
    this.unsubscribe = this.dependencies.adapter.subscribe((event) => this.handleAdapterEvent(event));

    try {
      this.started = true;
      await this.recoverPendingCommands();

      const descriptors = await this.dependencies.adapter.listRobots();
      for (const descriptor of descriptors) {
        this.managedRobotIds.add(descriptor.robotId);
        const state = await this.dependencies.adapter.getState(descriptor.robotId);
        const registration: RobotRegistration = {
          robotId: descriptor.robotId,
          displayName: descriptor.displayName,
          vendor: descriptor.vendor,
          model: descriptor.model,
          capabilities: [...descriptor.capabilities.actions],
          maxPayloadKg: descriptor.capabilities.maxPayloadKg,
          allowedZones: [...descriptor.capabilities.allowedZones],
        };
        await this.dependencies.transactions.runExclusive(async () => {
          const existing = await this.dependencies.robots.getById(
            descriptor.robotId,
            { forUpdate: true },
          );
          const existingSnapshot = existing?.snapshot();
          const adapterHasStaleAvailability = Boolean(
            existingSnapshot?.activeMissionId
            && (existingSnapshot.availability === "RESERVED" || existingSnapshot.availability === "EXECUTING")
            && state.activeMissionId === null
            && state.availability === "AVAILABLE",
          );
          const telemetry: RobotTelemetry = adapterHasStaleAvailability && existingSnapshot
            ? {
                robotId: existingSnapshot.robotId,
                sequence: existingSnapshot.sequence,
                observedAt: existingSnapshot.observedAt,
                connection: existingSnapshot.connection,
                availability: existingSnapshot.availability,
                batteryPercent: existingSnapshot.batteryPercent,
                pose: { ...existingSnapshot.pose },
                activeMissionId: existingSnapshot.activeMissionId,
              }
            : {
                robotId: state.robotId,
                sequence: state.sequence,
                observedAt: new Date(state.observedAt),
                connection: state.connection,
                availability: state.availability,
                batteryPercent: state.batteryPercent,
                pose: { ...state.pose },
                activeMissionId: state.activeMissionId,
              };
          const registered = Robot.register(registration, telemetry);
          registered.acknowledgeContact(this.dependencies.clock.now());
          await this.dependencies.robots.save(registered);
        });
      }
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.started = false;
      await this.dependencies.adapter.disconnect();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.dependencies.adapter.disconnect();
    this.managedRobotIds.clear();
    this.started = false;
  }

  async createMission(request: CreateMissionRequest): Promise<MissionView> {
    this.assertStarted();
    return this.dependencies.transactions.runExclusive(async () => {
      if (request.externalReference) {
        const existing = await this.dependencies.missions.findByExternalReference(request.externalReference);
        if (existing) return missionToView(existing);
      }

      await this.requirePublishedMap(request.pickup.mapId, true);

      const now = this.dependencies.clock.now();
      const mission = Mission.create({
        missionId: this.dependencies.ids.next("mission"),
        externalReference: request.externalReference,
        priority: request.priority,
        requiredCapabilities: [...request.requiredCapabilities],
        payloadKg: request.payloadKg,
        pickup: { ...request.pickup },
        dropoff: { ...request.dropoff },
        createdAt: now,
      });
      mission.queue(now);
      await this.dependencies.missions.save(mission);
      await this.dependencies.missionQueue.enqueue(mission.missionId, mission.priority, now);
      await this.appendMissionEvent(mission, "MISSION_QUEUED", "Mission accepted and queued.", now);
      return missionToView(mission);
    });
  }

  async dispatchMission(missionId: string): Promise<DispatchResult> {
    this.assertStarted();
    const preparation = await this.dependencies.transactions.runExclusive(async () => {
      const mission = await this.requireMission(missionId, true);
      if (mission.state !== "QUEUED") {
        throw new DomainError("MISSION_NOT_QUEUED", `Mission ${missionId} is ${mission.state}.`);
      }
      const robots = await this.dependencies.robots.list();
      const initialDecision = this.dependencies.dispatchPolicy.select(mission, robots);
      let robot: Robot | null = null;
      let selectedCandidate = null as AssignmentDecision["candidates"][number] | null;
      for (const candidate of initialDecision.candidates.filter((entry) => entry.eligible)) {
        const locked = await this.dependencies.robots.getById(candidate.robotId, {
          forUpdate: true,
          skipLocked: true,
        });
        if (!locked) continue;
        const reevaluated = this.dependencies.dispatchPolicy.select(mission, [locked]).candidates[0];
        if (!reevaluated?.eligible) continue;
        robot = locked;
        selectedCandidate = reevaluated;
        break;
      }
      const decision: AssignmentDecision = selectedCandidate
        ? {
            ...initialDecision,
            selectedRobotId: selectedCandidate.robotId,
            selectedScore: selectedCandidate.score,
            reasons: [...selectedCandidate.reasons],
          }
        : {
            ...initialDecision,
            selectedRobotId: null,
            selectedScore: null,
            reasons: initialDecision.selectedRobotId
              ? ["Eligible robots are currently reserved by another dispatcher."]
              : [...initialDecision.reasons],
          };
      const now = this.dependencies.clock.now();
      await this.dependencies.decisions.save(decision, now);
      if (!decision.selectedRobotId || !robot) {
        await this.appendMissionEvent(
          mission,
          "ASSIGNMENT_NOT_FOUND",
          "No eligible robot was available for dispatch.",
          now,
          { reasons: decision.reasons },
        );
        return { mission, decision, command: null, route: null };
      }

      const topology = await this.requirePublishedMap(mission.pickup.mapId, true);
      const existingReservations = await this.dependencies.traffic.listActiveReservations(
        topology.mapId,
        now,
      );
      const previousRoute = await this.dependencies.traffic.getByMission(mission.missionId);
      const trafficControls = await this.getTrafficControls(topology.mapId);
      const route = this.dependencies.trafficScheduler.schedule({
        routeId: previousRoute?.routeId ?? this.dependencies.ids.next("route"),
        missionId: mission.missionId,
        robotId: robot.robotId,
        topology,
        origin: robot.pose,
        pickup: mission.pickup,
        dropoff: mission.dropoff,
        requestedStartAt: new Date(now.getTime() + 5_000),
        plannedAt: now,
        existingReservations,
        excludedResourceIds: trafficControls.excludedResourceIds,
        infrastructureBindings: trafficControls.infrastructureBindings,
      });

      robot.reserve(mission.missionId, now);
      mission.assign(robot.robotId, now);
      await this.dependencies.robots.save(robot);
      await this.dependencies.missions.save(mission);
      await this.dependencies.missionQueue.complete(mission.missionId, "DISPATCHED", now);
      await this.dependencies.traffic.save(route);
      await this.appendMissionEvent(
        mission,
        "MISSION_ASSIGNED",
        `Mission assigned to ${robot.robotId}.`,
        now,
        { selectedScore: decision.selectedScore },
      );
      await this.appendRouteReservedEvents(mission, route, now);

      const commandId = this.dependencies.ids.next("command");
      const command = this.buildCommand(mission, robot.robotId, commandId, now, route);
      await this.dependencies.commands.enqueue(command, now);
      return { mission, decision, command, route } satisfies AssignmentPreparation;
    });

    if (!preparation.command) {
      return {
        mission: missionToView(preparation.mission),
        decision: preparation.decision,
        receipt: null,
        route: null,
      };
    }

    const claimed = await this.dependencies.commands.claimById(
      preparation.command.commandId,
      this.commandClaimOptions(),
    );
    const delivery = claimed
      ? await this.deliverCommand(claimed)
      : { mission: await this.requireMission(missionId), receipt: null };
    return {
      mission: missionToView(delivery.mission),
      decision: preparation.decision,
      receipt: delivery.receipt,
      route: await this.getMissionRoute(missionId),
    };
  }

  async cancelMission(missionId: string): Promise<MissionCancellationResult> {
    this.assertStarted();
    const preparation = await this.dependencies.transactions.runExclusive(async (): Promise<CancellationPreparation> => {
      const mission = await this.requireMission(missionId, true);
      const now = this.dependencies.clock.now();

      if (mission.state === "CANCELLED") return { mission, remoteCommand: null };
      if (mission.state === "COMPLETED" || mission.state === "FAILED") {
        throw new DomainError(
          "MISSION_NOT_CANCELLABLE",
          `Mission ${missionId} is already ${mission.state.toLowerCase()}.`,
        );
      }
      if (mission.state === "RECOVERY_REQUIRED") {
        throw new DomainError(
          "MISSION_RECOVERY_REQUIRED",
          `Mission ${missionId} must complete robot recovery before cancellation can be confirmed.`,
        );
      }

      if (mission.state === "QUEUED") {
        mission.cancelQueued(now);
        await this.dependencies.missions.save(mission);
        await this.dependencies.missionQueue.complete(mission.missionId, "CANCELLED", now);
        await this.appendMissionEvent(
          mission,
          "MISSION_CANCELLED",
          "Queued mission cancelled before robot assignment.",
          now,
        );
        return { mission, remoteCommand: null };
      }

      if (mission.state === "ASSIGNED") {
        const robotId = mission.assignedRobotId;
        if (!robotId) throw new DomainError("MISSION_ROBOT_MISSING", `Mission ${missionId} has no assigned robot.`);
        const robot = await this.requireRobot(robotId, true);
        mission.requestCancellation(now);
        await this.appendMissionEvent(
          mission,
          "MISSION_CANCELLATION_REQUESTED",
          "Mission cancellation requested before command acceptance.",
          now,
        );
        await this.dependencies.commands.cancelPendingByMission(
          mission.missionId,
          now,
          "Mission cancelled before the robot accepted its command.",
        );
        mission.cancel("", now);
        robot.release(mission.missionId, now);
        await this.dependencies.missions.save(mission);
        await this.dependencies.robots.save(robot);
        await this.appendMissionEvent(
          mission,
          "MISSION_CANCELLED",
          "Mission cancelled locally before command acceptance.",
          now,
        );
        await this.releaseTrafficPlan(mission, now, "Mission cancelled; traffic reservations released.");
        return { mission, remoteCommand: null };
      }

      if (mission.state === "DISPATCHED" || mission.state === "EXECUTING") {
        mission.requestCancellation(now);
        await this.dependencies.missions.save(mission);
        await this.appendMissionEvent(
          mission,
          "MISSION_CANCELLATION_REQUESTED",
          `Cancellation requested from robot ${mission.assignedRobotId}.`,
          now,
        );
      }

      if (mission.state !== "CANCELLING" || !mission.assignedRobotId || !mission.commandId) {
        throw new DomainError(
          "MISSION_CANCELLATION_INVALID",
          `Mission ${missionId} has no accepted robot command to cancel.`,
        );
      }

      return {
        mission,
        remoteCommand: { robotId: mission.assignedRobotId, commandId: mission.commandId },
      };
    });

    if (!preparation.remoteCommand) {
      return { mission: missionToView(preparation.mission), receipt: null };
    }

    let receipt: CommandReceipt | null = null;
    try {
      receipt = await this.dependencies.adapter.cancelMission(
        preparation.remoteCommand.robotId,
        preparation.remoteCommand.commandId,
      );
    } catch (error) {
      const failedAt = this.dependencies.clock.now();
      await this.dependencies.transactions.runExclusive(async () => {
        const mission = await this.requireMission(missionId, true);
        if (mission.state !== "CANCELLING") return;
        await this.dependencies.alarms.raise({
          fingerprint: `mission-cancellation:${mission.missionId}`,
          code: "MISSION_CANCELLATION_DELIVERY_FAILED",
          severity: "WARNING",
          title: `${mission.missionId} cancellation not delivered`,
          message: error instanceof Error ? error.message : "Robot adapter could not receive the cancellation request.",
          sourceType: "MISSION",
          sourceId: mission.missionId,
          occurredAt: failedAt,
        });
        await this.appendMissionEvent(
          mission,
          "MISSION_CANCELLATION_DELIVERY_FAILED",
          error instanceof Error ? error.message : "Robot adapter could not receive the cancellation request.",
          failedAt,
        );
      });
    }

    if (receipt?.status === "REJECTED") {
      const rejectedAt = new Date(receipt.receivedAt);
      await this.dependencies.transactions.runExclusive(async () => {
        const mission = await this.requireMission(missionId, true);
        if (mission.state !== "CANCELLING") return;
        await this.dependencies.alarms.raise({
          fingerprint: `mission-cancellation:${mission.missionId}`,
          code: "MISSION_CANCELLATION_REJECTED",
          severity: "WARNING",
          title: `${mission.missionId} cancellation rejected`,
          message: receipt?.reason ?? "Robot rejected the cancellation request.",
          sourceType: "MISSION",
          sourceId: mission.missionId,
          occurredAt: rejectedAt,
        });
        await this.appendMissionEvent(
          mission,
          "MISSION_CANCELLATION_REJECTED",
          receipt?.reason ?? "Robot rejected the cancellation request.",
          rejectedAt,
        );
      });
    }

    return { mission: await this.getMission(missionId), receipt };
  }

  async getMission(missionId: string): Promise<MissionView> {
    return missionToView(await this.requireMission(missionId));
  }

  async getDispatchQueue(): Promise<DispatchQueueView> {
    const evaluatedAt = this.dependencies.clock.now();
    const entries = await this.dependencies.missionQueue.listPending(
      evaluatedAt,
      this.dispatchQueueAgingIntervalMs,
    );
    const leased = entries.filter((entry) => entry.leaseExpiresAt && entry.leaseExpiresAt.getTime() > evaluatedAt.getTime());
    const due = entries.filter((entry) => entry.nextAttemptAt.getTime() <= evaluatedAt.getTime()
      && (!entry.leaseExpiresAt || entry.leaseExpiresAt.getTime() <= evaluatedAt.getTime()));
    return {
      evaluatedAt: evaluatedAt.toISOString(),
      pendingMissions: entries.length,
      dueMissions: due.length,
      leasedMissions: leased.length,
      nextAttemptAt: entries.length > 0
        ? new Date(Math.min(...entries.map((entry) => entry.nextAttemptAt.getTime()))).toISOString()
        : null,
      entries: entries.map((entry) => this.missionQueueEntryToView(entry)),
    };
  }

  async getAlarms(): Promise<AlarmSummaryView> {
    const evaluatedAt = this.dependencies.clock.now();
    const alarms = await this.dependencies.alarms.listActive();
    return {
      evaluatedAt: evaluatedAt.toISOString(),
      open: alarms.filter((alarm) => alarm.status === "OPEN").length,
      acknowledged: alarms.filter((alarm) => alarm.status === "ACKNOWLEDGED").length,
      critical: alarms.filter((alarm) => alarm.severity === "CRITICAL").length,
      warning: alarms.filter((alarm) => alarm.severity === "WARNING").length,
      alarms: alarms.map((alarm) => this.alarmToView(alarm)),
    };
  }

  async acknowledgeAlarm(alarmId: string, operatorId: string, note?: string): Promise<AlarmView> {
    const alarm = await this.dependencies.alarms.acknowledge(
      alarmId,
      operatorId,
      note ?? null,
      this.dependencies.clock.now(),
    );
    if (!alarm) throw new DomainError("ALARM_NOT_ACTIVE", `Alarm ${alarmId} was not found or is already resolved.`);
    return this.alarmToView(alarm);
  }

  async createWorkflow(request: CreateWorkflowRequest): Promise<WorkflowView> {
    this.assertStarted();
    if (request.externalReference) {
      const existing = await this.dependencies.workflows.findByExternalReference(request.externalReference);
      if (existing) return this.getWorkflow(existing.workflowId);
    }
    const now = this.dependencies.clock.now();
    const workflow: WorkflowRecord = {
      workflowId: this.dependencies.ids.next("workflow"),
      name: request.name,
      externalReference: request.externalReference ?? null,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      failureReason: null,
    };
    const steps: WorkflowStepRecord[] = request.steps.map((definition) => ({
      workflowId: workflow.workflowId,
      definition: structuredClone(definition),
      status: "PENDING",
      attemptCount: 0,
      missionId: null,
      resourceReservationId: null,
      startedAt: null,
      completedAt: null,
      nextAttemptAt: now,
      timeoutAt: null,
      waitUntil: null,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    }));
    try {
      await this.dependencies.workflows.create(workflow, steps);
    } catch (error) {
      if (request.externalReference && isUniqueConstraintViolation(error)) {
        const existing = await this.dependencies.workflows.findByExternalReference(request.externalReference);
        if (existing) return this.getWorkflow(existing.workflowId);
      }
      throw error;
    }
    return this.workflowToView(workflow, steps);
  }

  async getWorkflow(workflowId: string): Promise<WorkflowView> {
    const aggregate = await this.dependencies.workflows.getById(workflowId);
    if (!aggregate) throw new DomainError("WORKFLOW_NOT_FOUND", `Workflow ${workflowId} was not found.`);
    return this.workflowToView(aggregate.workflow, aggregate.steps);
  }

  async listWorkflows(): Promise<WorkflowView[]> {
    const records = await this.dependencies.workflows.list();
    return Promise.all(records.map((record) => this.getWorkflow(record.workflowId)));
  }

  async processWorkflowQueue(limit = 10): Promise<number> {
    this.assertStarted();
    const now = this.dependencies.clock.now();
    const claimed = await this.dependencies.workflows.claimRunnable(limit, {
      workerId: this.dependencies.instanceId,
      claimedAt: now,
      leaseDurationMs: this.workflowLeaseMs,
    });
    for (const step of claimed) await this.processWorkflowStep(step);
    return claimed.length;
  }

  async cancelWorkflow(workflowId: string): Promise<WorkflowView> {
    const aggregate = await this.dependencies.workflows.getById(workflowId);
    if (!aggregate) throw new DomainError("WORKFLOW_NOT_FOUND", `Workflow ${workflowId} was not found.`);
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(aggregate.workflow.status)) return this.workflowToView(aggregate.workflow, aggregate.steps);
    const now = this.dependencies.clock.now();
    let confirmationPending = false;
    for (const step of aggregate.steps) {
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(step.status)) continue;
      if (!await this.cancelWorkflowMission(step)) {
        confirmationPending = true;
        step.lastError = "Workflow cancellation is awaiting robot confirmation.";
        step.nextAttemptAt = new Date(now.getTime() + this.workflowPollMs);
        await this.saveWorkflowStep(step, now);
        continue;
      }
      await this.releaseWorkflowResource(step, now);
      step.status = "CANCELLED";
      step.completedAt = now;
      step.nextAttemptAt = now;
      step.leaseOwner = null;
      step.leaseExpiresAt = null;
      await this.dependencies.workflows.saveStep(step);
    }
    aggregate.workflow.status = confirmationPending ? "CANCELLING" : "CANCELLED";
    aggregate.workflow.completedAt = confirmationPending ? null : now;
    aggregate.workflow.updatedAt = now;
    aggregate.workflow.failureReason = confirmationPending ? "Workflow cancellation is awaiting robot confirmation." : null;
    await this.dependencies.workflows.saveWorkflow(aggregate.workflow);
    return this.getWorkflow(workflowId);
  }

  async getMissionEvents(missionId: string): Promise<MissionEventView[]> {
    await this.requireMission(missionId);
    return this.dependencies.events.listByMission(missionId);
  }

  async getMissionRoute(missionId: string): Promise<TrafficPlanView | null> {
    await this.requireMission(missionId);
    const plan = await this.dependencies.traffic.getByMission(missionId);
    return plan ? trafficPlanToView(plan) : null;
  }

  async getMapTopology(mapId: string): Promise<MapTopologyView> {
    return topologyToView(await this.requireMapTopology(mapId));
  }

  async listMapTopologies(): Promise<MapTopologyView[]> {
    return (await this.dependencies.maps.list()).map(topologyToView);
  }

  async listMapVersions(familyId?: string): Promise<MapVersionView[]> {
    return (await this.dependencies.maps.listVersions(familyId)).map((record) => this.mapVersionToView(record));
  }

  async createMapVersion(input: CreateMapVersionRequest): Promise<MapVersionView> {
    const mapId = `${input.familyId}@${input.revision}`;
    if ((await this.dependencies.maps.getVersion(mapId))) {
      throw new DomainError("MAP_VERSION_EXISTS", `Map version ${mapId} already exists.`);
    }
    const topology = MapTopology.create({
      mapId,
      displayName: input.displayName,
      revision: input.revision,
      nodes: input.nodes.map((node) => ({ ...node })),
      edges: input.edges.map((edge) => ({ ...edge })),
    });
    let created: MapVersionRecord;
    try {
      created = await this.dependencies.maps.createDraft(
        topology,
        input.familyId,
        input.operatorId,
        this.dependencies.clock.now(),
      );
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new DomainError("MAP_VERSION_EXISTS", `Map version ${mapId} already exists.`);
      throw error;
    }
    return this.mapVersionToView(created);
  }

  async publishMapVersion(mapId: string, operatorId: string): Promise<MapVersionView> {
    const version = await this.dependencies.maps.publish(mapId, operatorId, this.dependencies.clock.now());
    if (!version) throw new DomainError("MAP_DRAFT_NOT_FOUND", `Draft map version ${mapId} was not found.`);
    return this.mapVersionToView(version);
  }

  async retireMapVersion(mapId: string, operatorId: string): Promise<MapVersionView> {
    const version = await this.dependencies.maps.getVersion(mapId);
    if (!version || version.status !== "PUBLISHED") throw new DomainError("MAP_PUBLISHED_NOT_FOUND", `Published map version ${mapId} was not found.`);
    const published = (await this.dependencies.maps.listVersions(version.familyId)).filter((candidate) => candidate.status === "PUBLISHED");
    if (published.length <= 1) throw new DomainError("MAP_LAST_PUBLISHED_VERSION", `Publish a replacement for ${version.familyId} before retiring ${mapId}.`);
    const activeMissionStates = new Set(["CREATED", "QUEUED", "ASSIGNED", "DISPATCHED", "EXECUTING", "RECOVERY_REQUIRED", "CANCELLING"]);
    const inUseByMission = (await this.dependencies.missions.list()).find((mission) => {
      const snapshot = mission.snapshot();
      return snapshot.pickup.mapId === mapId && activeMissionStates.has(snapshot.state);
    });
    if (inUseByMission) throw new DomainError("MAP_VERSION_IN_USE", `${mapId} is used by mission ${inUseByMission.missionId}.`);
    const robotOnMap = (await this.dependencies.robots.list()).find((robot) => robot.pose.mapId === mapId);
    if (robotOnMap) throw new DomainError("MAP_VERSION_IN_USE", `${mapId} is still reported by robot ${robotOnMap.robotId}.`);
    const retired = await this.dependencies.maps.retire(mapId, operatorId, this.dependencies.clock.now());
    if (!retired) throw new DomainError("MAP_PUBLISHED_NOT_FOUND", `Published map version ${mapId} was not found.`);
    return this.mapVersionToView(retired);
  }

  async listInfrastructureResources(mapId: string): Promise<InfrastructureResourceView[]> {
    await this.requireMapTopology(mapId);
    return (await this.dependencies.infrastructureResources.listByMap(mapId)).map((record) => this.infrastructureResourceToView(record));
  }

  async createInfrastructureResource(input: CreateInfrastructureResourceRequest): Promise<InfrastructureResourceView> {
    const topology = await this.requireMapTopology(input.mapId);
    const mapVersion = await this.dependencies.maps.getVersion(input.mapId);
    if (!mapVersion || mapVersion.status === "RETIRED") throw new DomainError("MAP_VERSION_RETIRED", `Infrastructure cannot be added to retired map ${input.mapId}.`);
    if (input.edgeId && !topology.edges.some((edge) => edge.edgeId === input.edgeId)) throw new DomainError("MAP_EDGE_NOT_FOUND", `Edge ${input.edgeId} was not found.`);
    if (input.nodeId) topology.getNode(input.nodeId);
    if (["DOOR", "ELEVATOR"].includes(input.type) && input.reservationPolicy !== "TRANSIT_EXCLUSIVE") {
      throw new DomainError("INFRASTRUCTURE_POLICY_INVALID", `${input.type} must use TRANSIT_EXCLUSIVE reservation policy.`);
    }
    if (["CHARGER", "DOCK", "WORKCELL"].includes(input.type) && input.reservationPolicy !== "SERVICE_EXCLUSIVE") {
      throw new DomainError("INFRASTRUCTURE_POLICY_INVALID", `${input.type} must use SERVICE_EXCLUSIVE reservation policy.`);
    }
    const existing = await this.dependencies.infrastructureResources.getById(input.resourceId);
    if (existing) throw new DomainError("INFRASTRUCTURE_RESOURCE_EXISTS", `Infrastructure resource ${input.resourceId} already exists.`);
    const now = this.dependencies.clock.now();
    let created: InfrastructureResourceRecord;
    try {
      created = await this.dependencies.infrastructureResources.create({
        resourceId: input.resourceId,
        mapId: input.mapId,
        displayName: input.displayName,
        type: input.type,
        status: "AVAILABLE",
        reservationPolicy: input.reservationPolicy,
        edgeId: input.edgeId ?? null,
        nodeId: input.nodeId ?? null,
        createdBy: input.operatorId,
        createdAt: now,
        updatedBy: input.operatorId,
        updatedAt: now,
        statusReason: null,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new DomainError("INFRASTRUCTURE_RESOURCE_EXISTS", `Infrastructure resource ${input.resourceId} already exists.`);
      throw error;
    }
    return this.infrastructureResourceToView(created);
  }

  async updateInfrastructureResourceStatus(
    resourceId: string,
    status: InfrastructureResourceStatus,
    reason: string,
    operatorId: string,
  ): Promise<InfrastructureResourceView> {
    const now = this.dependencies.clock.now();
    const updated = await this.dependencies.infrastructureResources.updateStatus(resourceId, status, reason, operatorId, now);
    if (!updated) throw new DomainError("INFRASTRUCTURE_RESOURCE_NOT_FOUND", `Infrastructure resource ${resourceId} was not found.`);
    const plans = await this.dependencies.traffic.listByMap(updated.mapId);
    for (const plan of plans) {
      const fingerprint = `infrastructure:${resourceId}:${plan.missionId}`;
      if (status === "AVAILABLE") {
        await this.dependencies.alarms.resolveByFingerprint(fingerprint, now);
      } else if (plan.status === "ACTIVE" && plan.reservations.some((reservation) => reservation.resourceId === `infrastructure:${resourceId}`)) {
        await this.dependencies.alarms.raise({
          fingerprint,
          code: "INFRASTRUCTURE_RESOURCE_UNAVAILABLE",
          severity: "CRITICAL",
          title: `${updated.displayName} is ${status.toLowerCase()}`,
          message: `${plan.missionId} has an active reservation on ${resourceId}; operator coordination is required. Reason: ${reason}`,
          sourceType: "TRAFFIC",
          sourceId: plan.missionId,
          occurredAt: now,
        });
      }
    }
    return this.infrastructureResourceToView(updated);
  }

  async getTrafficSchedule(mapId: string): Promise<TrafficScheduleView> {
    await this.requireMapTopology(mapId);
    const now = this.dependencies.clock.now();
    const [plans, reservations] = await Promise.all([
      this.dependencies.traffic.listByMap(mapId),
      this.dependencies.traffic.listActiveReservations(mapId, now),
    ]);
    return {
      mapId,
      updatedAt: now.toISOString(),
      plans: plans.map(trafficPlanToView),
      reservations: reservations.map(trafficReservationToView),
    };
  }

  async listTrafficRestrictions(mapId: string): Promise<TrafficRestrictionView[]> {
    await this.requireMapTopology(mapId);
    return (await this.dependencies.trafficRestrictions.listActive(mapId)).map((entry) => this.trafficRestrictionToView(entry));
  }

  async createTrafficRestriction(input: { mapId: string; resourceId: string; reason: string; operatorId: string }): Promise<TrafficRestrictionView> {
    const topology = await this.requireMapTopology(input.mapId);
    if (input.resourceId.startsWith("edge:")) {
      const edgeId = input.resourceId.slice(5);
      if (!topology.edges.some((edge) => edge.edgeId === edgeId)) throw new DomainError("MAP_EDGE_NOT_FOUND", `Edge ${edgeId} was not found.`);
    } else topology.getNode(input.resourceId.slice(5));
    const now = this.dependencies.clock.now();
    const restriction = await this.dependencies.trafficRestrictions.create(input.mapId, input.resourceId, input.reason, input.operatorId, now);
    const impacted = (await this.dependencies.traffic.listByMap(input.mapId))
      .filter((plan) => plan.status === "ACTIVE" && plan.reservations.some((reservation) => reservation.resourceId === input.resourceId));
    for (const plan of impacted) {
      await this.dependencies.alarms.raise({
        fingerprint: `traffic-restriction:${restriction.restrictionId}:${plan.missionId}`,
        code: "ACTIVE_ROUTE_RESTRICTED", severity: "CRITICAL",
        title: `${plan.missionId} uses a closed resource`,
        message: `${input.resourceId} closed while the route was active; operator coordination is required.`,
        sourceType: "TRAFFIC", sourceId: plan.missionId, occurredAt: now,
      });
    }
    return this.trafficRestrictionToView(restriction);
  }

  async clearTrafficRestriction(restrictionId: string, operatorId: string): Promise<TrafficRestrictionView> {
    const now = this.dependencies.clock.now();
    const cleared = await this.dependencies.trafficRestrictions.clear(restrictionId, operatorId, now);
    if (!cleared) throw new DomainError("TRAFFIC_RESTRICTION_NOT_FOUND", `Active restriction ${restrictionId} was not found.`);
    for (const plan of await this.dependencies.traffic.listByMap(cleared.mapId)) {
      await this.dependencies.alarms.resolveByFingerprint(`traffic-restriction:${restrictionId}:${plan.missionId}`, now);
    }
    return this.trafficRestrictionToView(cleared);
  }

  async getRecoveryStatus(): Promise<FleetRecoveryStatusView> {
    const evaluatedAt = this.dependencies.clock.now();
    const [robots, missions, maps] = await Promise.all([
      this.dependencies.robots.list(),
      this.dependencies.missions.list(),
      this.dependencies.maps.list(),
    ]);
    const plans = (await Promise.all(maps.map((map) => this.dependencies.traffic.listByMap(map.mapId)))).flat();
    const renewable = plans.filter((plan) => plan.status === "ACTIVE");
    return {
      evaluatedAt: evaluatedAt.toISOString(),
      degradedRobots: robots.filter((robot) => robot.connection === "DEGRADED").length,
      offlineRobots: robots.filter((robot) => robot.connection === "OFFLINE").length,
      recoveryRequiredMissions: missions.filter((mission) => mission.state === "RECOVERY_REQUIRED").length,
      safetyHolds: plans.filter((plan) => plan.status === "SAFETY_HOLD").length,
      nextLeaseExpiryAt: renewable.length > 0
        ? new Date(Math.min(...renewable.map((plan) => plan.leaseExpiresAt.getTime()))).toISOString()
        : null,
    };
  }

  async processFleetRecovery(limit = 100): Promise<number> {
    this.assertStarted();
    const candidates = (await this.dependencies.robots.list())
      .filter((robot) => this.managedRobotIds.has(robot.robotId))
      .slice(0, limit);
    let changes = 0;

    for (const candidate of candidates) {
      const changed = await this.dependencies.transactions.runExclusive(async () => {
        const robot = await this.dependencies.robots.getById(candidate.robotId, {
          forUpdate: true,
          skipLocked: true,
        });
        if (!robot) return false;
        const now = this.dependencies.clock.now();
        const liveness = this.dependencies.livenessPolicy.evaluate(robot, now);
        const connectionChanged = robot.markConnection(liveness.connection, now);
        const mission = robot.activeMissionId
          ? await this.dependencies.missions.getById(robot.activeMissionId, { forUpdate: true })
          : null;

        if (connectionChanged && liveness.connection === "DEGRADED") {
          await this.dependencies.alarms.raise({
            fingerprint: `robot-heartbeat-degraded:${robot.robotId}`,
            code: "ROBOT_HEARTBEAT_DEGRADED",
            severity: "WARNING",
            title: `${robot.robotId} heartbeat delayed`,
            message: `No current heartbeat has been received from ${robot.displayName}.`,
            sourceType: "ROBOT",
            sourceId: robot.robotId,
            occurredAt: now,
          });
        }
        if (connectionChanged && mission && liveness.connection === "DEGRADED") {
          await this.appendMissionEvent(
            mission,
            "ROBOT_CONNECTION_DEGRADED",
            `Robot ${robot.robotId} heartbeat is delayed.`,
            now,
            { heartbeatAgeMs: liveness.ageMs, lastSeenAt: robot.lastSeenAt.toISOString() },
          );
        }

        if (connectionChanged && liveness.connection === "OFFLINE") {
          await this.dependencies.alarms.resolveByFingerprint(`robot-heartbeat-degraded:${robot.robotId}`, now);
          await this.dependencies.alarms.raise({
            fingerprint: `robot-offline:${robot.robotId}`,
            code: "ROBOT_OFFLINE",
            severity: "CRITICAL",
            title: `${robot.robotId} is offline`,
            message: mission
              ? `${robot.displayName} exceeded the heartbeat timeout while owning ${mission.missionId}.`
              : `${robot.displayName} exceeded the heartbeat timeout.`,
            sourceType: "ROBOT",
            sourceId: robot.robotId,
            occurredAt: now,
          });
        }

        if (liveness.connection === "OFFLINE" && mission) {
          if (connectionChanged) {
            await this.appendMissionEvent(
              mission,
              "ROBOT_OFFLINE",
              `Robot ${robot.robotId} heartbeat expired.`,
              now,
              { heartbeatAgeMs: liveness.ageMs, lastSeenAt: robot.lastSeenAt.toISOString() },
            );
          }
          if (["ASSIGNED", "DISPATCHED", "EXECUTING"].includes(mission.state)) {
            mission.requireRecovery(`Robot ${robot.robotId} is offline; operator safety recovery is required.`, now);
            await this.dependencies.alarms.raise({
              fingerprint: `mission-recovery:${mission.missionId}`,
              code: "MISSION_RECOVERY_REQUIRED",
              severity: "CRITICAL",
              title: `${mission.missionId} requires recovery`,
              message: `Mission ownership is uncertain because ${robot.robotId} is offline.`,
              sourceType: "MISSION",
              sourceId: mission.missionId,
              occurredAt: now,
            });
            await this.dependencies.commands.deferPendingByMission(
              mission.missionId,
              new Date(now.getTime() + 24 * 60 * 60_000),
              "Command delivery suspended while robot recovery is required.",
            );
            await this.dependencies.missions.save(mission);
            await this.appendMissionEvent(
              mission,
              "MISSION_RECOVERY_REQUIRED",
              "Mission paused because the assigned robot is unreachable.",
              now,
              { previousState: mission.recoveryPreviousState },
            );
            const currentRoute = await this.dependencies.traffic.getByMission(mission.missionId);
            if (currentRoute) await this.requireMapTopology(currentRoute.mapId, true);
            const held = await this.dependencies.traffic.placeSafetyHoldByMission(mission.missionId, now);
            if (held) {
              await this.appendMissionEvent(
                mission,
                "TRAFFIC_SAFETY_HOLD",
                "Traffic resources remain blocked until the robot reports a safe state.",
                now,
                { routeId: held.routeId },
              );
            }
          }
        } else if (liveness.connection === "ONLINE") {
          if (connectionChanged) {
            await this.dependencies.alarms.resolveByFingerprint(`robot-heartbeat-degraded:${robot.robotId}`, now);
            await this.dependencies.alarms.resolveByFingerprint(`robot-offline:${robot.robotId}`, now);
          }
          if (!mission || mission.state === "RECOVERY_REQUIRED") {
            if (connectionChanged) await this.dependencies.robots.save(robot);
            return connectionChanged || mission?.state === "RECOVERY_REQUIRED";
          }
          const route = await this.dependencies.traffic.getByMission(mission.missionId);
          if (
            route?.status === "ACTIVE"
            && route.leaseExpiresAt.getTime() <= now.getTime() + this.renewLeaseWithinMs
          ) {
            await this.dependencies.traffic.renewLeaseByMission(
              mission.missionId,
              now,
              new Date(now.getTime() + this.trafficLeaseMs),
            );
          }
        }

        if (connectionChanged) await this.dependencies.robots.save(robot);
        return connectionChanged || mission?.state === "RECOVERY_REQUIRED";
      });
      if (changed) changes += 1;
    }
    return changes;
  }

  async processPendingCommands(limit = 25): Promise<number> {
    this.assertStarted();
    const pending = await this.dependencies.commands.claimPending(
      limit,
      this.commandClaimOptions(),
    );
    for (const entry of pending) await this.deliverCommand(entry);
    return pending.length;
  }

  async processMissionQueue(limit = 25): Promise<number> {
    this.assertStarted();
    const claimedAt = this.dependencies.clock.now();
    const entries = await this.dependencies.missionQueue.claimDue(limit, {
      workerId: this.dependencies.instanceId,
      claimedAt,
      leaseDurationMs: this.dispatchQueueLeaseMs,
      agingIntervalMs: this.dispatchQueueAgingIntervalMs,
    });

    for (const entry of entries) {
      try {
        const result = await this.dispatchMission(entry.missionId);
        if (!result.decision.selectedRobotId) {
          await this.deferMissionQueueEntry(
            entry,
            result.decision.reasons.join(" ") || "No eligible robot is currently available.",
          );
        }
      } catch (error) {
        if (error instanceof DomainError && error.code === "MISSION_NOT_QUEUED") {
          const mission = await this.dependencies.missions.getById(entry.missionId);
          if (mission && mission.state !== "QUEUED") {
            await this.dependencies.missionQueue.complete(
              entry.missionId,
              mission.state === "CANCELLED" ? "CANCELLED" : "DISPATCHED",
              this.dependencies.clock.now(),
            );
            continue;
          }
        }
        await this.deferMissionQueueEntry(
          entry,
          error instanceof Error ? error.message : "Automatic mission dispatch failed.",
        );
      }
    }
    return entries.length;
  }

  async getSnapshot(): Promise<FleetSnapshot> {
    const [robots, missions] = await Promise.all([
      this.dependencies.robots.list(),
      this.dependencies.missions.list(),
    ]);
    return {
      schemaVersion: FLEET_SCHEMA_VERSION,
      updatedAt: this.dependencies.clock.now().toISOString(),
      robots: robots.map(robotToView),
      missions: missions.map(missionToView),
    };
  }

  async handleAdapterEvent(event: RobotAdapterEvent): Promise<void> {
    let redispatchMissionId: string | null = null;
    await this.dependencies.transactions.runExclusive(async () => {
      if (event.type === "ROBOT_STATE") {
        const robot = await this.requireRobot(event.state.robotId, true);
        const previousMissionId = robot.activeMissionId;
        const receivedAt = this.dependencies.clock.now();
        const applied = robot.applyTelemetry({
          robotId: event.state.robotId,
          sequence: event.state.sequence,
          observedAt: new Date(event.state.observedAt),
          connection: event.state.connection,
          availability: event.state.availability,
          batteryPercent: event.state.batteryPercent,
          pose: { ...event.state.pose },
          activeMissionId: event.state.activeMissionId,
        }, receivedAt);
        if (!applied) return;

        if (event.state.connection === "ONLINE") {
          await this.dependencies.alarms.resolveByFingerprint(`robot-heartbeat-degraded:${robot.robotId}`, receivedAt);
          await this.dependencies.alarms.resolveByFingerprint(`robot-offline:${robot.robotId}`, receivedAt);
        }

        if (previousMissionId && event.state.connection === "ONLINE") {
          const mission = await this.dependencies.missions.getById(previousMissionId, { forUpdate: true });
          if (mission?.state === "RECOVERY_REQUIRED") {
            if (event.state.activeMissionId === previousMissionId) {
              mission.resumeRecovery(receivedAt);
              await this.dependencies.alarms.resolveByFingerprint(`mission-recovery:${mission.missionId}`, receivedAt);
              await this.dependencies.commands.resumePendingByMission(mission.missionId, receivedAt);
              await this.dependencies.traffic.acknowledgeSafetyHoldByMission(
                mission.missionId,
                receivedAt,
                new Date(receivedAt.getTime() + this.trafficLeaseMs),
              );
              await this.dependencies.missions.save(mission);
              await this.appendMissionEvent(
                mission,
                "MISSION_RECOVERED",
                "Robot reconnected and confirmed the mission is still active.",
                receivedAt,
              );
            } else if (event.state.activeMissionId === null && event.state.availability === "AVAILABLE") {
              const previousRobotId = mission.assignedRobotId;
              const previousCommandId = mission.commandId;
              mission.requeueAfterRecovery("Robot confirmed that the previous command is no longer active.", receivedAt);
              await this.dependencies.alarms.resolveByFingerprint(`mission-recovery:${mission.missionId}`, receivedAt);
              await this.dependencies.missionQueue.enqueue(mission.missionId, mission.priority, receivedAt);
              await this.dependencies.commands.cancelPendingByMission(
                mission.missionId,
                receivedAt,
                "Superseded after connectivity recovery and mission reassignment.",
              );
              robot.quarantine(previousMissionId, receivedAt);
              await this.releaseTrafficPlan(
                mission,
                receivedAt,
                "Robot reported a clear state; safety hold released before reassignment.",
              );
              await this.dependencies.missions.save(mission);
              await this.appendMissionEvent(
                mission,
                "MISSION_RECOVERY_REQUEUED",
                "Recovered mission was automatically returned to the dispatch queue.",
                receivedAt,
                {},
                { robotId: previousRobotId ?? undefined, commandId: previousCommandId ?? undefined },
              );
              redispatchMissionId = mission.missionId;
            }
          }
        }
        await this.dependencies.robots.save(robot);
        return;
      }

      const mission = await this.requireMission(event.missionId, true);
      const robot = await this.requireRobot(event.robotId, true);
      const observedAt = new Date(event.observedAt);
      robot.acknowledgeContact(this.dependencies.clock.now());

      if (mission.state === "RECOVERY_REQUIRED") {
        mission.resumeRecovery(observedAt);
        await this.dependencies.alarms.resolveByFingerprint(`mission-recovery:${mission.missionId}`, observedAt);
        await this.dependencies.commands.resumePendingByMission(mission.missionId, observedAt);
        await this.dependencies.traffic.acknowledgeSafetyHoldByMission(
          mission.missionId,
          observedAt,
          new Date(observedAt.getTime() + this.trafficLeaseMs),
        );
        await this.appendMissionEvent(
          mission,
          "MISSION_RECOVERED",
          "Robot status resumed the mission after a connectivity interruption.",
          observedAt,
        );
      }

      if (mission.state === "CANCELLED" || mission.state === "COMPLETED" || mission.state === "FAILED") {
        await this.dependencies.robots.save(robot);
        return;
      }

      if (event.status === "EXECUTING") {
        if (mission.state === "CANCELLING") {
          if (robot.availability === "RESERVED") {
            robot.markExecuting(event.missionId, observedAt);
            await this.appendMissionEvent(
              mission,
              "MISSION_EXECUTING",
              "Robot began execution while cancellation confirmation was pending.",
              observedAt,
            );
          }
        } else if (mission.state !== "EXECUTING") {
          mission.markExecuting(event.commandId, observedAt);
          robot.markExecuting(event.missionId, observedAt);
          await this.appendMissionEvent(mission, "MISSION_EXECUTING", "Robot started mission execution.", observedAt);
        }
      } else if (event.status === "COMPLETED") {
        mission.complete(event.commandId, observedAt);
        await this.dependencies.alarms.resolveByFingerprint(`mission-cancellation:${mission.missionId}`, observedAt);
        robot.release(event.missionId, observedAt);
        await this.appendMissionEvent(mission, "MISSION_COMPLETED", "Robot completed the mission.", observedAt);
        await this.releaseTrafficPlan(mission, observedAt, "Mission completed; traffic reservations released.");
      } else if (event.status === "FAILED") {
        mission.fail(event.commandId, event.reason ?? "Robot reported mission failure.", observedAt);
        await this.dependencies.alarms.resolveByFingerprint(`mission-cancellation:${mission.missionId}`, observedAt);
        robot.release(event.missionId, observedAt);
        await this.appendMissionEvent(
          mission,
          "MISSION_FAILED",
          event.reason ?? "Robot reported mission failure.",
          observedAt,
        );
        await this.releaseTrafficPlan(mission, observedAt, "Mission failed; traffic reservations released.");
      } else {
        if (mission.state !== "CANCELLING") mission.requestCancellation(observedAt);
        mission.cancel(event.commandId, observedAt);
        await this.dependencies.alarms.resolveByFingerprint(`mission-cancellation:${mission.missionId}`, observedAt);
        robot.release(event.missionId, observedAt);
        await this.appendMissionEvent(mission, "MISSION_CANCELLED", "Mission cancellation confirmed.", observedAt);
        await this.releaseTrafficPlan(mission, observedAt, "Mission cancelled; traffic reservations released.");
      }

      await this.dependencies.missions.save(mission);
      await this.dependencies.robots.save(robot);
    });

    if (redispatchMissionId) {
      try {
        await this.dispatchMission(redispatchMissionId);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
      }
    }
  }

  private buildCommand(
    mission: Mission,
    robotId: string,
    commandId: string,
    now: Date,
    route: TrafficPlanSnapshot,
  ): MissionCommand {
    return {
      schemaVersion: FLEET_SCHEMA_VERSION,
      commandId,
      missionId: mission.missionId,
      robotId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(Math.max(now.getTime() + 30_000, route.scheduledStartAt.getTime() + 30_000)).toISOString(),
      mapId: mission.pickup.mapId,
      steps: [
        { type: "MOVE_TO", target: { ...mission.pickup } },
        { type: "LOAD", stationId: mission.pickup.stationId, payloadKg: mission.payloadKg },
        { type: "MOVE_TO", target: { ...mission.dropoff } },
        { type: "UNLOAD", stationId: mission.dropoff.stationId },
      ],
      route: {
        routeId: route.routeId,
        scheduledStartAt: route.scheduledStartAt.toISOString(),
        expectedArrivalAt: route.expectedArrivalAt.toISOString(),
        segments: trafficPlanToView(route).segments,
      },
    };
  }

  private async recoverPendingCommands(): Promise<void> {
    await this.processPendingCommands();
  }

  private async deliverCommand(pending: PendingCommand): Promise<CommandDeliveryResult> {
    const command = await this.refreshStaleRoute(pending.command);
    const current = await this.requireMission(command.missionId);
    if (current.state === "RECOVERY_REQUIRED") {
      const now = this.dependencies.clock.now();
      await this.dependencies.commands.deferPendingByMission(
        current.missionId,
        new Date(now.getTime() + 24 * 60 * 60_000),
        "Command delivery suspended while robot recovery is required.",
      );
      return { mission: current, receipt: null };
    }
    const attemptedAt = this.dependencies.clock.now();
    await this.dependencies.commands.recordAttempt(command.commandId, attemptedAt);

    let receipt: CommandReceipt;
    try {
      receipt = await this.dependencies.adapter.executeMission(command);
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "Robot adapter failed without an error message.";
      const mission = await this.dependencies.transactions.runExclusive(async () => {
        await this.dependencies.commands.recordAttemptFailure(
          command.commandId,
          reason,
          attemptedAt,
          new Date(attemptedAt.getTime() + this.retryDelayMs(pending.attemptCount + 1)),
        );
        const currentMission = await this.requireMission(command.missionId, true);
        await this.dependencies.alarms.raise({
          fingerprint: `command-delivery:${currentMission.missionId}`,
          code: "COMMAND_DELIVERY_FAILED",
          severity: "WARNING",
          title: `${currentMission.missionId} command delivery failed`,
          message: reason,
          sourceType: "MISSION",
          sourceId: currentMission.missionId,
          occurredAt: attemptedAt,
        });
        await this.appendMissionEvent(
          currentMission,
          "COMMAND_DELIVERY_FAILED",
          `Command delivery failed: ${reason}`,
          attemptedAt,
          { attempt: pending.attemptCount + 1 },
          { robotId: command.robotId, commandId: command.commandId },
        );
        return currentMission;
      });
      return { mission, receipt: null };
    }

    const mission = await this.dependencies.transactions.runExclusive(async () => {
      const currentMission = await this.requireMission(command.missionId, true);
      const robot = await this.requireRobot(command.robotId, true);
      const now = this.dependencies.clock.now();

      if (receipt.status === "ACCEPTED") {
        await this.dependencies.alarms.resolveByFingerprint(`command-delivery:${currentMission.missionId}`, now);
        if (currentMission.state === "ASSIGNED") {
          currentMission.markDispatched(command.commandId, now);
          await this.appendMissionEvent(
            currentMission,
            "COMMAND_DISPATCHED",
            `Robot ${command.robotId} accepted the command.`,
            now,
          );
        }
      } else if (currentMission.state === "ASSIGNED") {
        currentMission.releaseRejectedAssignment(receipt.reason ?? "Robot rejected the mission.", now);
        await this.dependencies.missionQueue.enqueue(currentMission.missionId, currentMission.priority, now);
        robot.release(command.missionId, now);
        await this.dependencies.robots.save(robot);
        await this.appendMissionEvent(
          currentMission,
          "COMMAND_REJECTED",
          receipt.reason ?? "Robot rejected the mission.",
          now,
          {},
          { robotId: command.robotId, commandId: command.commandId },
        );
        await this.releaseTrafficPlan(currentMission, now, "Robot rejected the command; traffic reservations released.");
      }

      await this.dependencies.commands.recordReceipt(receipt);
      await this.dependencies.missions.save(currentMission);
      return currentMission;
    });

    return { mission, receipt };
  }

  private commandClaimOptions() {
    return {
      workerId: this.dependencies.instanceId,
      claimedAt: this.dependencies.clock.now(),
      leaseDurationMs: 30_000,
    };
  }

  private retryDelayMs(attempt: number): number {
    return Math.min(1_000 * (2 ** Math.max(0, attempt - 1)), 60_000);
  }

  private dispatchRetryDelayMs(attempt: number): number {
    return Math.min(
      this.dispatchRetryBaseMs * (2 ** Math.max(0, attempt - 1)),
      this.dispatchRetryMaxMs,
    );
  }

  private async deferMissionQueueEntry(entry: MissionQueueEntry, reason: string): Promise<void> {
    const attemptedAt = this.dependencies.clock.now();
    await this.dependencies.missionQueue.defer(
      entry.missionId,
      attemptedAt,
      new Date(attemptedAt.getTime() + this.dispatchRetryDelayMs(entry.attemptCount)),
      reason,
    );
  }

  private missionQueueEntryToView(entry: MissionQueueEntry) {
    return {
      missionId: entry.missionId,
      basePriority: entry.basePriority,
      effectivePriority: entry.effectivePriority,
      attemptCount: entry.attemptCount,
      enqueuedAt: entry.enqueuedAt.toISOString(),
      nextAttemptAt: entry.nextAttemptAt.toISOString(),
      lastAttemptAt: entry.lastAttemptAt?.toISOString() ?? null,
      lastError: entry.lastError,
      leaseOwner: entry.leaseOwner,
      leaseExpiresAt: entry.leaseExpiresAt?.toISOString() ?? null,
    };
  }

  private alarmToView(alarm: AlarmRecord): AlarmView {
    return {
      alarmId: alarm.alarmId,
      fingerprint: alarm.fingerprint,
      code: alarm.code,
      severity: alarm.severity,
      status: alarm.status,
      title: alarm.title,
      message: alarm.message,
      sourceType: alarm.sourceType,
      sourceId: alarm.sourceId,
      occurrenceCount: alarm.occurrenceCount,
      firstOccurredAt: alarm.firstOccurredAt.toISOString(),
      lastOccurredAt: alarm.lastOccurredAt.toISOString(),
      acknowledgedAt: alarm.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: alarm.acknowledgedBy,
      acknowledgementNote: alarm.acknowledgementNote,
      resolvedAt: alarm.resolvedAt?.toISOString() ?? null,
    };
  }

  private trafficRestrictionToView(record: TrafficRestrictionRecord): TrafficRestrictionView {
    return {
      restrictionId: record.restrictionId, mapId: record.mapId, resourceId: record.resourceId,
      status: record.status, reason: record.reason, createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(), clearedBy: record.clearedBy,
      clearedAt: record.clearedAt?.toISOString() ?? null,
    };
  }

  private mapVersionToView(record: MapVersionRecord): MapVersionView {
    return {
      mapId: record.topology.mapId,
      familyId: record.familyId,
      displayName: record.topology.displayName,
      revision: record.topology.revision,
      status: record.status,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      publishedBy: record.publishedBy,
      publishedAt: record.publishedAt?.toISOString() ?? null,
      retiredBy: record.retiredBy,
      retiredAt: record.retiredAt?.toISOString() ?? null,
      nodeCount: record.topology.nodes.length,
      edgeCount: record.topology.edges.length,
    };
  }

  private infrastructureResourceToView(record: InfrastructureResourceRecord): InfrastructureResourceView {
    return {
      resourceId: record.resourceId,
      mapId: record.mapId,
      displayName: record.displayName,
      type: record.type,
      status: record.status,
      reservationPolicy: record.reservationPolicy,
      edgeId: record.edgeId,
      nodeId: record.nodeId,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedBy: record.updatedBy,
      updatedAt: record.updatedAt.toISOString(),
      statusReason: record.statusReason,
    };
  }

  private workflowToView(workflow: WorkflowRecord, steps: WorkflowStepRecord[]): WorkflowView {
    return {
      workflowId: workflow.workflowId,
      name: workflow.name,
      externalReference: workflow.externalReference,
      status: workflow.status,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
      completedAt: workflow.completedAt?.toISOString() ?? null,
      failureReason: workflow.failureReason,
      steps: steps.map((step) => ({
        ...structuredClone(step.definition),
        status: step.status,
        attemptCount: step.attemptCount,
        missionId: step.missionId,
        startedAt: step.startedAt?.toISOString() ?? null,
        completedAt: step.completedAt?.toISOString() ?? null,
        nextAttemptAt: step.nextAttemptAt.toISOString(),
        timeoutAt: step.timeoutAt?.toISOString() ?? null,
        waitUntil: step.waitUntil?.toISOString() ?? null,
        lastError: step.lastError,
      })),
    };
  }

  private async getTrafficControls(mapId: string): Promise<{
    excludedResourceIds: string[];
    infrastructureBindings: Array<{ resourceId: string; edgeId: string | null; nodeId: string | null }>;
  }> {
    const [restrictions, resources] = await Promise.all([
      this.dependencies.trafficRestrictions.listActive(mapId),
      this.dependencies.infrastructureResources.listByMap(mapId),
    ]);
    const transitResources = resources.filter((resource) => resource.reservationPolicy === "TRANSIT_EXCLUSIVE");
    return {
      excludedResourceIds: [
        ...restrictions.map((restriction) => restriction.resourceId),
        ...transitResources.filter((resource) => resource.status !== "AVAILABLE").map((resource) => resource.edgeId ? `edge:${resource.edgeId}` : `node:${resource.nodeId}`),
      ],
      infrastructureBindings: transitResources.filter((resource) => resource.status === "AVAILABLE").map((resource) => ({
        resourceId: resource.resourceId,
        edgeId: resource.edgeId,
        nodeId: resource.nodeId,
      })),
    };
  }

  private async processWorkflowStep(claimed: WorkflowStepRecord): Promise<void> {
    const aggregate = await this.dependencies.workflows.getById(claimed.workflowId);
    if (!aggregate || !["PENDING", "RUNNING", "CANCELLING"].includes(aggregate.workflow.status)) return;
    const step = aggregate.steps.find((candidate) => candidate.definition.stepId === claimed.definition.stepId);
    if (!step || !["PENDING", "WAITING_RETRY", "RUNNING"].includes(step.status)) return;
    const now = this.dependencies.clock.now();
    try {
      if (aggregate.workflow.status === "CANCELLING") {
        if (!await this.cancelWorkflowMission(step)) {
          step.lastError = "Workflow cancellation is awaiting robot confirmation.";
          step.nextAttemptAt = new Date(now.getTime() + this.workflowPollMs);
          await this.saveWorkflowStep(step, now);
          return;
        }
        await this.releaseWorkflowResource(step, now);
        step.status = "CANCELLED";
        step.completedAt = now;
        step.nextAttemptAt = now;
        await this.saveWorkflowStep(step, now);
        const cancellation = await this.dependencies.workflows.getById(step.workflowId);
        if (cancellation && cancellation.steps.every((candidate) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(candidate.status))) {
          cancellation.workflow.status = "CANCELLED";
          cancellation.workflow.completedAt = now;
          cancellation.workflow.updatedAt = now;
          cancellation.workflow.failureReason = null;
          await this.dependencies.workflows.saveWorkflow(cancellation.workflow);
        }
        return;
      }
      if (step.status === "RUNNING" && step.timeoutAt && step.timeoutAt.getTime() <= now.getTime()) {
        await this.failWorkflowStep(aggregate.workflow, step, `Step timed out after ${step.definition.timeoutSeconds} seconds.`, now);
        return;
      }

      if (step.status !== "RUNNING") {
        step.status = "RUNNING";
        step.attemptCount += 1;
        step.startedAt = now;
        step.completedAt = null;
        step.timeoutAt = new Date(now.getTime() + step.definition.timeoutSeconds * 1_000);
        step.waitUntil = null;
        step.lastError = null;
        await this.saveWorkflowStep(step, now);
        if (aggregate.workflow.status === "PENDING") {
          aggregate.workflow.status = "RUNNING";
          aggregate.workflow.updatedAt = now;
          await this.dependencies.workflows.saveWorkflow(aggregate.workflow);
        }
      }

      await this.ensureWorkflowResource(step, now);

      if (step.definition.type === "WAIT") {
        if (!step.waitUntil) step.waitUntil = new Date(now.getTime() + step.definition.durationSeconds! * 1_000);
        if (step.waitUntil.getTime() > now.getTime()) {
          step.nextAttemptAt = step.timeoutAt && step.timeoutAt < step.waitUntil ? step.timeoutAt : step.waitUntil;
          await this.saveWorkflowStep(step, now);
          return;
        }
        await this.completeWorkflowStep(aggregate.workflow, step, now);
        return;
      }

      if (!step.missionId) {
        const mission = await this.createMission({
          ...structuredClone(step.definition.mission!),
          externalReference: `workflow:${step.workflowId}:${step.definition.stepId}:attempt:${step.attemptCount}`,
          autoDispatch: false,
        });
        step.missionId = mission.missionId;
        step.nextAttemptAt = new Date(now.getTime() + this.workflowPollMs);
        await this.saveWorkflowStep(step, now);
      }

      let mission = await this.getMission(step.missionId);
      if (mission.state === "QUEUED") {
        try {
          const result = await this.dispatchMission(mission.missionId);
          mission = result.mission;
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== "MISSION_NOT_QUEUED") throw error;
          mission = await this.getMission(step.missionId);
        }
      }

      if (mission.state === "COMPLETED") {
        if (step.definition.durationSeconds) {
          if (!step.waitUntil) step.waitUntil = new Date(now.getTime() + step.definition.durationSeconds * 1_000);
          if (step.waitUntil.getTime() > now.getTime()) {
            step.nextAttemptAt = step.timeoutAt && step.timeoutAt < step.waitUntil ? step.timeoutAt : step.waitUntil;
            await this.saveWorkflowStep(step, now);
            return;
          }
        }
        await this.completeWorkflowStep(aggregate.workflow, step, now);
        return;
      }
      if (["FAILED", "CANCELLED"].includes(mission.state)) {
        throw new Error(`Mission ${mission.missionId} ended as ${mission.state}${mission.failureReason ? `: ${mission.failureReason}` : ""}.`);
      }
      step.nextAttemptAt = new Date(now.getTime() + this.workflowPollMs);
      await this.saveWorkflowStep(step, now);
    } catch (error) {
      await this.failWorkflowStep(
        aggregate.workflow,
        step,
        error instanceof Error ? error.message : "Workflow step failed.",
        now,
      );
    }
  }

  private async ensureWorkflowResource(step: WorkflowStepRecord, now: Date): Promise<void> {
    const resourceId = step.definition.resourceId;
    if (!resourceId) return;
    if (step.resourceReservationId) return;
    const recovered = await this.dependencies.workflowResourceReservations.getActiveByStep(step.workflowId, step.definition.stepId);
    if (recovered) {
      step.resourceReservationId = recovered.reservationId;
      await this.saveWorkflowStep(step, now);
      return;
    }
    const resource = await this.dependencies.infrastructureResources.getById(resourceId);
    if (!resource) throw new Error(`Service resource ${resourceId} was not found.`);
    if (resource.status !== "AVAILABLE") throw new Error(`Service resource ${resourceId} is ${resource.status.toLowerCase()}.`);
    if (resource.reservationPolicy !== "SERVICE_EXCLUSIVE") throw new Error(`Resource ${resourceId} is not a service resource.`);
    const expectedType = ({ CHARGE: "CHARGER", INSPECT: "WORKCELL", DOCK: "DOCK" } as const)[step.definition.type as "CHARGE" | "INSPECT" | "DOCK"];
    if (expectedType && resource.type !== expectedType) throw new Error(`${step.definition.type} requires ${expectedType}, received ${resource.type}.`);
    if (step.definition.mission?.pickup.mapId !== resource.mapId) throw new Error(`Resource ${resourceId} belongs to a different map version.`);
    const reservationId = this.dependencies.ids.next("workflowReservation");
    const reserved = await this.dependencies.workflowResourceReservations.tryReserve({
      reservationId,
      workflowId: step.workflowId,
      stepId: step.definition.stepId,
      resourceId,
      startsAt: now,
      endsAt: step.timeoutAt ?? new Date(now.getTime() + step.definition.timeoutSeconds * 1_000),
      state: "ACTIVE",
      releasedAt: null,
    });
    if (!reserved) throw new Error(`Service resource ${resourceId} is reserved by another workflow.`);
    step.resourceReservationId = reserved.reservationId;
    await this.saveWorkflowStep(step, now);
  }

  private async completeWorkflowStep(workflow: WorkflowRecord, step: WorkflowStepRecord, now: Date): Promise<void> {
    await this.releaseWorkflowResource(step, now);
    step.status = "SUCCEEDED";
    step.completedAt = now;
    step.nextAttemptAt = now;
    step.lastError = null;
    await this.saveWorkflowStep(step, now);
    const aggregate = await this.dependencies.workflows.getById(workflow.workflowId);
    if (aggregate && aggregate.steps.every((candidate) => candidate.status === "SUCCEEDED")) {
      aggregate.workflow.status = "SUCCEEDED";
      aggregate.workflow.completedAt = now;
      aggregate.workflow.updatedAt = now;
      aggregate.workflow.failureReason = null;
      await this.dependencies.workflows.saveWorkflow(aggregate.workflow);
    }
  }

  private async failWorkflowStep(workflow: WorkflowRecord, step: WorkflowStepRecord, reason: string, now: Date): Promise<void> {
    const missionClear = await this.cancelWorkflowMission(step);
    if (!missionClear) {
      step.status = "RUNNING";
      step.lastError = `${reason} Cancellation confirmation is pending.`;
      step.nextAttemptAt = new Date(now.getTime() + this.workflowPollMs);
      await this.saveWorkflowStep(step, now);
      return;
    }
    await this.releaseWorkflowResource(step, now);
    if (step.attemptCount < step.definition.maxAttempts) {
      step.status = "WAITING_RETRY";
      step.missionId = null;
      step.startedAt = null;
      step.completedAt = null;
      step.timeoutAt = null;
      step.waitUntil = null;
      step.lastError = reason;
      step.nextAttemptAt = new Date(now.getTime() + step.definition.retryDelaySeconds * 1_000);
      await this.saveWorkflowStep(step, now);
      return;
    }

    step.status = "FAILED";
    step.completedAt = now;
    step.lastError = reason;
    step.nextAttemptAt = now;
    await this.saveWorkflowStep(step, now);
    const aggregate = await this.dependencies.workflows.getById(workflow.workflowId);
    if (aggregate) {
      for (const candidate of aggregate.steps) {
        if (candidate.definition.stepId === step.definition.stepId || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(candidate.status)) continue;
        if (!await this.cancelWorkflowMission(candidate)) continue;
        await this.releaseWorkflowResource(candidate, now);
        candidate.status = "CANCELLED";
        candidate.completedAt = now;
        candidate.nextAttemptAt = now;
        await this.saveWorkflowStep(candidate, now);
      }
      aggregate.workflow.status = "FAILED";
      aggregate.workflow.completedAt = now;
      aggregate.workflow.updatedAt = now;
      aggregate.workflow.failureReason = `${step.definition.stepId}: ${reason}`;
      await this.dependencies.workflows.saveWorkflow(aggregate.workflow);
    }
  }

  private async cancelWorkflowMission(step: WorkflowStepRecord): Promise<boolean> {
    if (!step.missionId) return true;
    const mission = await this.getMission(step.missionId);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(mission.state)) return true;
    try {
      const result = await this.cancelMission(step.missionId);
      return result.mission.state === "CANCELLED";
    } catch {
      return false;
    }
  }

  private async releaseWorkflowResource(step: WorkflowStepRecord, now: Date): Promise<void> {
    if (!step.resourceReservationId) return;
    await this.dependencies.workflowResourceReservations.release(step.resourceReservationId, now);
    step.resourceReservationId = null;
  }

  private async saveWorkflowStep(step: WorkflowStepRecord, now: Date): Promise<void> {
    step.leaseOwner = null;
    step.leaseExpiresAt = null;
    await this.dependencies.workflows.saveStep(step);
    const aggregate = await this.dependencies.workflows.getById(step.workflowId);
    if (aggregate && aggregate.workflow.status === "PENDING") {
      aggregate.workflow.status = "RUNNING";
      aggregate.workflow.updatedAt = now;
      await this.dependencies.workflows.saveWorkflow(aggregate.workflow);
    }
  }

  private async appendMissionEvent(
    mission: Mission,
    type: MissionEventType,
    message: string,
    occurredAt: Date,
    data: Record<string, unknown> = {},
    identity: { robotId?: string; commandId?: string } = {},
  ): Promise<void> {
    await this.dependencies.events.append({
      missionId: mission.missionId,
      type,
      state: mission.state,
      robotId: identity.robotId ?? mission.assignedRobotId,
      commandId: identity.commandId ?? mission.commandId,
      message,
      data,
      occurredAt,
    });
  }

  private async appendRouteReservedEvents(
    mission: Mission,
    route: TrafficPlanSnapshot,
    occurredAt: Date,
    rescheduled = false,
  ): Promise<void> {
    await this.appendMissionEvent(
      mission,
      "ROUTE_RESERVED",
      rescheduled ? "Traffic route reservations were refreshed." : "A conflict-free traffic route was reserved.",
      occurredAt,
      {
        routeId: route.routeId,
        segments: route.segments.length,
        distanceMeters: route.totalDistanceMeters,
        scheduledStartAt: route.scheduledStartAt.toISOString(),
        expectedArrivalAt: route.expectedArrivalAt.toISOString(),
        rescheduled,
      },
    );
    if (route.totalWaitSeconds > 0) {
      await this.appendMissionEvent(
        mission,
        "ROUTE_DELAYED",
        `Traffic conflicts delayed route entry by ${route.totalWaitSeconds.toFixed(1)} seconds.`,
        occurredAt,
        { routeId: route.routeId, waitSeconds: route.totalWaitSeconds },
      );
    }
  }

  private async releaseTrafficPlan(mission: Mission, releasedAt: Date, message: string): Promise<void> {
    const current = await this.dependencies.traffic.getByMission(mission.missionId);
    if (!current || (current.status !== "ACTIVE" && current.status !== "SAFETY_HOLD")) return;
    const released = await this.dependencies.traffic.releaseByMission(mission.missionId, releasedAt);
    await this.appendMissionEvent(
      mission,
      "ROUTE_RELEASED",
      message,
      releasedAt,
      { routeId: released?.routeId ?? current.routeId },
    );
  }

  private async refreshStaleRoute(command: MissionCommand): Promise<MissionCommand> {
    if (!command.route) return command;
    const now = this.dependencies.clock.now();
    if (new Date(command.route.scheduledStartAt).getTime() > now.getTime() + 1_000) return command;

    return this.dependencies.transactions.runExclusive(async () => {
      const mission = await this.requireMission(command.missionId, true);
      if (mission.state !== "ASSIGNED") return command;
      const robot = await this.requireRobot(command.robotId, true);
      const current = await this.dependencies.traffic.getByMission(mission.missionId);
      if (!current || current.status !== "ACTIVE") return command;
      const topology = await this.requireMapTopology(current.mapId, true);
      const existingReservations = await this.dependencies.traffic.listActiveReservations(
        current.mapId,
        now,
        mission.missionId,
      );
      const trafficControls = await this.getTrafficControls(current.mapId);
      const route = this.dependencies.trafficScheduler.schedule({
        routeId: current.routeId,
        missionId: mission.missionId,
        robotId: robot.robotId,
        topology,
        origin: robot.pose,
        pickup: mission.pickup,
        dropoff: mission.dropoff,
        requestedStartAt: new Date(now.getTime() + 5_000),
        plannedAt: now,
        existingReservations,
        excludedResourceIds: trafficControls.excludedResourceIds,
        infrastructureBindings: trafficControls.infrastructureBindings,
      });
      await this.dependencies.traffic.save(route);
      const refreshed = this.buildCommand(mission, robot.robotId, command.commandId, now, route);
      await this.dependencies.commands.updatePending(refreshed, now);
      await this.appendRouteReservedEvents(mission, route, now, true);
      return refreshed;
    });
  }

  private async requireMission(missionId: string, forUpdate = false): Promise<Mission> {
    const mission = await this.dependencies.missions.getById(missionId, { forUpdate });
    if (!mission) throw new DomainError("MISSION_NOT_FOUND", `Mission ${missionId} was not found.`);
    return mission;
  }

  private async requireRobot(robotId: string, forUpdate = false): Promise<Robot> {
    const robot = await this.dependencies.robots.getById(robotId, { forUpdate });
    if (!robot) throw new DomainError("ROBOT_NOT_FOUND", `Robot ${robotId} was not found.`);
    return robot;
  }

  private async requireMapTopology(mapId: string, forUpdate = false) {
    const topology = await this.dependencies.maps.getById(mapId, { forUpdate });
    if (!topology) throw new DomainError("MAP_NOT_FOUND", `Map topology ${mapId} was not found.`);
    return topology;
  }

  private async requirePublishedMap(mapId: string, forUpdate = false) {
    const version = await this.dependencies.maps.getVersion(mapId, { forUpdate });
    if (!version) throw new DomainError("MAP_NOT_FOUND", `Map topology ${mapId} was not found.`);
    if (version.status !== "PUBLISHED") throw new DomainError("MAP_VERSION_NOT_PUBLISHED", `Map version ${mapId} is ${version.status.toLowerCase()}.`);
    return version.topology;
  }

  private assertStarted(): void {
    if (!this.started) throw new Error("Fleet Core has not been started.");
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}
