import {
  FLEET_SCHEMA_VERSION,
  type AssignmentDecision,
  type CommandReceipt,
  type CreateMissionRequest,
  type DispatchResult,
  type FleetRecoveryStatusView,
  type FleetSnapshot,
  type MapTopologyView,
  type MissionCancellationResult,
  type MissionCommand,
  type MissionEventType,
  type MissionEventView,
  type MissionView,
  type RobotAdapterEvent,
  type TrafficPlanView,
  type TrafficScheduleView,
} from "@brash/contracts";
import {
  DomainError,
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
  CommandRepository,
  MissionEventRepository,
  MissionRepository,
  MapTopologyRepository,
  PendingCommand,
  RobotRepository,
  TrafficPlanRepository,
  TransactionManager,
} from "./ports/repositories.js";
import { WeightedDispatchPolicy } from "./policies/weighted-dispatch-policy.js";

export interface FleetCoreDependencies {
  missions: MissionRepository;
  robots: RobotRepository;
  commands: CommandRepository;
  decisions: AssignmentDecisionRepository;
  events: MissionEventRepository;
  maps: MapTopologyRepository;
  traffic: TrafficPlanRepository;
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
  private readonly managedRobotIds = new Set<string>();
  private unsubscribe: Unsubscribe | null = null;
  private started = false;

  constructor(dependencies: FleetCoreDependencies, recoveryOptions: FleetRecoveryOptions = {}) {
    this.dependencies = dependencies;
    this.trafficLeaseMs = recoveryOptions.trafficLeaseMs ?? 45_000;
    this.renewLeaseWithinMs = recoveryOptions.renewLeaseWithinMs ?? 20_000;
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

      const topology = await this.requireMapTopology(mission.pickup.mapId, true);
      const existingReservations = await this.dependencies.traffic.listActiveReservations(
        topology.mapId,
        now,
      );
      const previousRoute = await this.dependencies.traffic.getByMission(mission.missionId);
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
      });

      robot.reserve(mission.missionId, now);
      mission.assign(robot.robotId, now);
      await this.dependencies.robots.save(robot);
      await this.dependencies.missions.save(mission);
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

        if (connectionChanged && mission && liveness.connection === "DEGRADED") {
          await this.appendMissionEvent(
            mission,
            "ROBOT_CONNECTION_DEGRADED",
            `Robot ${robot.robotId} heartbeat is delayed.`,
            now,
            { heartbeatAgeMs: liveness.ageMs, lastSeenAt: robot.lastSeenAt.toISOString() },
          );
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
        } else if (liveness.connection === "ONLINE" && mission && mission.state !== "RECOVERY_REQUIRED") {
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

        if (previousMissionId && event.state.connection === "ONLINE") {
          const mission = await this.dependencies.missions.getById(previousMissionId, { forUpdate: true });
          if (mission?.state === "RECOVERY_REQUIRED") {
            if (event.state.activeMissionId === previousMissionId) {
              mission.resumeRecovery(receivedAt);
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
        robot.release(event.missionId, observedAt);
        await this.appendMissionEvent(mission, "MISSION_COMPLETED", "Robot completed the mission.", observedAt);
        await this.releaseTrafficPlan(mission, observedAt, "Mission completed; traffic reservations released.");
      } else if (event.status === "FAILED") {
        mission.fail(event.commandId, event.reason ?? "Robot reported mission failure.", observedAt);
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

  private assertStarted(): void {
    if (!this.started) throw new Error("Fleet Core has not been started.");
  }
}
