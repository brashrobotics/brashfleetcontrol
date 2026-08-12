import {
  FLEET_SCHEMA_VERSION,
  type AssignmentDecision,
  type CommandReceipt,
  type CreateMissionRequest,
  type DispatchResult,
  type FleetSnapshot,
  type MissionCommand,
  type MissionView,
  type RobotAdapterEvent,
} from "@brash/contracts";
import {
  DomainError,
  Mission,
  Robot,
  type RobotRegistration,
  type RobotTelemetry,
} from "@brash/domain";
import type { RobotAdapter, Unsubscribe } from "@brash/robot-adapter-sdk";
import { missionToView, robotToView } from "./mappers.js";
import type { Clock, IdGenerator } from "./ports/platform.js";
import type {
  AssignmentDecisionRepository,
  CommandRepository,
  MissionRepository,
  RobotRepository,
  TransactionManager,
} from "./ports/repositories.js";
import { WeightedDispatchPolicy } from "./policies/weighted-dispatch-policy.js";

export interface FleetCoreDependencies {
  missions: MissionRepository;
  robots: RobotRepository;
  commands: CommandRepository;
  decisions: AssignmentDecisionRepository;
  transactions: TransactionManager;
  clock: Clock;
  ids: IdGenerator;
  adapter: RobotAdapter;
  dispatchPolicy: WeightedDispatchPolicy;
}

interface AssignmentPreparation {
  mission: Mission;
  decision: AssignmentDecision;
  command: MissionCommand | null;
}

interface CommandDeliveryResult {
  mission: Mission;
  receipt: CommandReceipt | null;
}

export class FleetCore {
  private readonly dependencies: FleetCoreDependencies;
  private unsubscribe: Unsubscribe | null = null;
  private started = false;

  constructor(dependencies: FleetCoreDependencies) {
    this.dependencies = dependencies;
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
          await this.dependencies.robots.save(Robot.register(registration, telemetry));
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
    this.started = false;
  }

  async createMission(request: CreateMissionRequest): Promise<MissionView> {
    this.assertStarted();
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
    return missionToView(mission);
  }

  async dispatchMission(missionId: string): Promise<DispatchResult> {
    this.assertStarted();
    const preparation = await this.dependencies.transactions.runExclusive(async () => {
      const mission = await this.requireMission(missionId, true);
      if (mission.state !== "QUEUED") {
        throw new DomainError("MISSION_NOT_QUEUED", `Mission ${missionId} is ${mission.state}.`);
      }
      const robots = await this.dependencies.robots.list({ forUpdate: true, skipLocked: true });
      const decision = this.dependencies.dispatchPolicy.select(mission, robots);
      const now = this.dependencies.clock.now();
      await this.dependencies.decisions.save(decision, now);
      if (!decision.selectedRobotId) return { mission, decision, command: null };

      const robot = await this.requireRobot(decision.selectedRobotId, true);
      robot.reserve(mission.missionId, now);
      mission.assign(robot.robotId, now);
      await this.dependencies.robots.save(robot);
      await this.dependencies.missions.save(mission);

      const commandId = this.dependencies.ids.next("command");
      const command = this.buildCommand(mission, robot.robotId, commandId, now);
      await this.dependencies.commands.enqueue(command, now);
      return { mission, decision, command } satisfies AssignmentPreparation;
    });

    if (!preparation.command) {
      return { mission: missionToView(preparation.mission), decision: preparation.decision, receipt: null };
    }

    const delivery = await this.deliverCommand(preparation.command);
    return {
      mission: missionToView(delivery.mission),
      decision: preparation.decision,
      receipt: delivery.receipt,
    };
  }

  async getMission(missionId: string): Promise<MissionView> {
    return missionToView(await this.requireMission(missionId));
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
    await this.dependencies.transactions.runExclusive(async () => {
      if (event.type === "ROBOT_STATE") {
        const robot = await this.requireRobot(event.state.robotId, true);
        robot.applyTelemetry({
          robotId: event.state.robotId,
          sequence: event.state.sequence,
          observedAt: new Date(event.state.observedAt),
          connection: event.state.connection,
          availability: event.state.availability,
          batteryPercent: event.state.batteryPercent,
          pose: { ...event.state.pose },
          activeMissionId: event.state.activeMissionId,
        });
        await this.dependencies.robots.save(robot);
        return;
      }

      const mission = await this.requireMission(event.missionId, true);
      const robot = await this.requireRobot(event.robotId, true);
      const observedAt = new Date(event.observedAt);

      if (event.status === "EXECUTING") {
        if (mission.state === "EXECUTING") return;
        mission.markExecuting(event.commandId, observedAt);
        robot.markExecuting(event.missionId, observedAt);
      } else if (event.status === "COMPLETED") {
        if (mission.state === "COMPLETED") return;
        mission.complete(event.commandId, observedAt);
        robot.release(event.missionId, observedAt);
      } else if (event.status === "FAILED") {
        if (mission.state === "FAILED") return;
        mission.fail(event.commandId, event.reason ?? "Robot reported mission failure.", observedAt);
        robot.release(event.missionId, observedAt);
      } else {
        if (mission.state === "CANCELLED") return;
        if (mission.state !== "CANCELLING") mission.requestCancellation(observedAt);
        mission.cancel(event.commandId, observedAt);
        robot.release(event.missionId, observedAt);
      }

      await this.dependencies.missions.save(mission);
      await this.dependencies.robots.save(robot);
    });
  }

  private buildCommand(mission: Mission, robotId: string, commandId: string, now: Date): MissionCommand {
    return {
      schemaVersion: FLEET_SCHEMA_VERSION,
      commandId,
      missionId: mission.missionId,
      robotId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
      mapId: mission.pickup.mapId,
      steps: [
        { type: "MOVE_TO", target: { ...mission.pickup } },
        { type: "LOAD", stationId: mission.pickup.stationId, payloadKg: mission.payloadKg },
        { type: "MOVE_TO", target: { ...mission.dropoff } },
        { type: "UNLOAD", stationId: mission.dropoff.stationId },
      ],
    };
  }

  private async recoverPendingCommands(): Promise<void> {
    const pending = await this.dependencies.commands.listPending();
    for (const entry of pending) await this.deliverCommand(entry.command);
  }

  private async deliverCommand(command: MissionCommand): Promise<CommandDeliveryResult> {
    const attemptedAt = this.dependencies.clock.now();
    await this.dependencies.commands.recordAttempt(command.commandId, attemptedAt);

    let receipt: CommandReceipt;
    try {
      receipt = await this.dependencies.adapter.executeMission(command);
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "Robot adapter failed without an error message.";
      await this.dependencies.commands.recordAttemptFailure(
        command.commandId,
        reason,
        this.dependencies.clock.now(),
      );
      return { mission: await this.requireMission(command.missionId), receipt: null };
    }

    const mission = await this.dependencies.transactions.runExclusive(async () => {
      const currentMission = await this.requireMission(command.missionId, true);
      const robot = await this.requireRobot(command.robotId, true);
      const now = this.dependencies.clock.now();

      if (receipt.status === "ACCEPTED") {
        if (currentMission.state === "ASSIGNED") currentMission.markDispatched(command.commandId, now);
      } else if (currentMission.state === "ASSIGNED") {
        currentMission.releaseRejectedAssignment(receipt.reason ?? "Robot rejected the mission.", now);
        robot.release(command.missionId, now);
        await this.dependencies.robots.save(robot);
      }

      await this.dependencies.commands.recordReceipt(receipt);
      await this.dependencies.missions.save(currentMission);
      return currentMission;
    });

    return { mission, receipt };
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

  private assertStarted(): void {
    if (!this.started) throw new Error("Fleet Core has not been started.");
  }
}
