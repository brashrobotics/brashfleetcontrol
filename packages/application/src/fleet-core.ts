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
  MissionRepository,
  RobotRepository,
  TransactionManager,
} from "./ports/repositories.js";
import { WeightedDispatchPolicy } from "./policies/weighted-dispatch-policy.js";

export interface FleetCoreDependencies {
  missions: MissionRepository;
  robots: RobotRepository;
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
      const telemetry: RobotTelemetry = {
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
    }
    this.started = true;
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
      const mission = await this.requireMission(missionId);
      if (mission.state !== "QUEUED") {
        throw new DomainError("MISSION_NOT_QUEUED", `Mission ${missionId} is ${mission.state}.`);
      }
      const robots = await this.dependencies.robots.list();
      const decision = this.dependencies.dispatchPolicy.select(mission, robots);
      if (!decision.selectedRobotId) return { mission, decision, command: null };

      const robot = await this.requireRobot(decision.selectedRobotId);
      const now = this.dependencies.clock.now();
      robot.reserve(mission.missionId, now);
      mission.assign(robot.robotId, now);
      await this.dependencies.robots.save(robot);
      await this.dependencies.missions.save(mission);

      const commandId = this.dependencies.ids.next("command");
      const command = this.buildCommand(mission, robot.robotId, commandId, now);
      return { mission, decision, command } satisfies AssignmentPreparation;
    });

    if (!preparation.command) {
      return { mission: missionToView(preparation.mission), decision: preparation.decision, receipt: null };
    }

    let receipt: CommandReceipt;
    try {
      receipt = await this.dependencies.adapter.executeMission(preparation.command);
    } catch (error) {
      receipt = {
        schemaVersion: FLEET_SCHEMA_VERSION,
        commandId: preparation.command.commandId,
        missionId: preparation.command.missionId,
        robotId: preparation.command.robotId,
        status: "REJECTED",
        receivedAt: this.dependencies.clock.now().toISOString(),
        reason: error instanceof Error ? error.message : "Robot adapter failed without an error message.",
      };
    }

    const updatedMission = await this.dependencies.transactions.runExclusive(async () => {
      const mission = await this.requireMission(missionId);
      const robot = await this.requireRobot(preparation.command!.robotId);
      const now = this.dependencies.clock.now();
      if (receipt.status === "ACCEPTED") {
        mission.markDispatched(preparation.command!.commandId, now);
      } else {
        mission.releaseRejectedAssignment(receipt.reason ?? "Robot rejected the mission.", now);
        robot.release(missionId, now);
        await this.dependencies.robots.save(robot);
      }
      await this.dependencies.missions.save(mission);
      return mission;
    });

    return { mission: missionToView(updatedMission), decision: preparation.decision, receipt };
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
        const robot = await this.requireRobot(event.state.robotId);
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

      const mission = await this.requireMission(event.missionId);
      const robot = await this.requireRobot(event.robotId);
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

  private async requireMission(missionId: string): Promise<Mission> {
    const mission = await this.dependencies.missions.getById(missionId);
    if (!mission) throw new DomainError("MISSION_NOT_FOUND", `Mission ${missionId} was not found.`);
    return mission;
  }

  private async requireRobot(robotId: string): Promise<Robot> {
    const robot = await this.dependencies.robots.getById(robotId);
    if (!robot) throw new DomainError("ROBOT_NOT_FOUND", `Robot ${robotId} was not found.`);
    return robot;
  }

  private assertStarted(): void {
    if (!this.started) throw new Error("Fleet Core has not been started.");
  }
}

