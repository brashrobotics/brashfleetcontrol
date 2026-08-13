import {
  FleetCore,
  type InfrastructureResourceRecord,
  RandomIdGenerator,
  SystemClock,
  createDefaultPlantTopology,
  WeightedDispatchPolicy,
} from "@brash/application";
import { RobotLivenessPolicy, TrafficScheduler } from "@brash/domain";
import { FLEET_SCHEMA_VERSION, type RobotDescriptor, type RobotStateSnapshot } from "@brash/contracts";
import { SimulatorAdapter, type SimulatorRobotDefinition } from "@brash/simulator-adapter";
import {
  InMemoryAssignmentDecisionRepository,
  InMemoryAlarmRepository,
  InMemoryCommandRepository,
  InMemoryInfrastructureResourceRepository,
  InMemoryMissionEventRepository,
  InMemoryMissionQueueRepository,
  InMemoryMissionRepository,
  InMemoryMapTopologyRepository,
  InMemoryRobotRepository,
  InMemoryTransactionManager,
  InMemoryTrafficPlanRepository,
  InMemoryTrafficRestrictionRepository,
  InMemoryWorkflowRepository,
  InMemoryWorkflowResourceReservationRepository,
} from "@brash/persistence";
import { FleetApi } from "../api/fleet-api.js";

function simulatorRobot(input: {
  robotId: string;
  displayName: string;
  capabilities: string[];
  maxPayloadKg: number;
  batteryPercent: number;
  x: number;
  y: number;
}): SimulatorRobotDefinition {
  const descriptor: RobotDescriptor = {
    robotId: input.robotId,
    displayName: input.displayName,
    vendor: "BRASH",
    model: "SIM-AMR",
    capabilities: {
      actions: input.capabilities,
      maxPayloadKg: input.maxPayloadKg,
      allowedZones: ["warehouse", "production", "quality"],
    },
  };
  const observedAt = new Date().toISOString();
  const state: RobotStateSnapshot = {
    schemaVersion: FLEET_SCHEMA_VERSION,
    robotId: input.robotId,
    sequence: 1,
    observedAt,
    lastSeenAt: observedAt,
    connectionChangedAt: observedAt,
    connection: "ONLINE",
    availability: "AVAILABLE",
    batteryPercent: input.batteryPercent,
    pose: { mapId: "plant-a@1", x: input.x, y: input.y, yaw: 0 },
    activeMissionId: null,
  };
  return { descriptor, state };
}

export function createDevelopmentAdapter(): SimulatorAdapter {
  return new SimulatorAdapter([
    simulatorRobot({ robotId: "BR-01", displayName: "Atlas", capabilities: ["pallet_transport"], maxPayloadKg: 500, batteryPercent: 70, x: 40, y: 5 }),
    simulatorRobot({ robotId: "BR-02", displayName: "Nova", capabilities: ["box_transport"], maxPayloadKg: 100, batteryPercent: 90, x: 10, y: 5 }),
    simulatorRobot({ robotId: "BR-03", displayName: "Kite", capabilities: ["pallet_transport"], maxPayloadKg: 800, batteryPercent: 35, x: 70, y: 65 }),
  ], { autoAdvance: true, heartbeatIntervalMs: 1_000 });
}

export function createDevelopmentSystem() {
  const adapter = createDevelopmentAdapter();
  const topology = createDefaultPlantTopology();
  const infrastructureResources = new InMemoryInfrastructureResourceRepository(defaultInfrastructureResources());

  const core = new FleetCore({
    alarms: new InMemoryAlarmRepository(),
    missions: new InMemoryMissionRepository(),
    missionQueue: new InMemoryMissionQueueRepository(),
    robots: new InMemoryRobotRepository(),
    commands: new InMemoryCommandRepository(),
    decisions: new InMemoryAssignmentDecisionRepository(),
    events: new InMemoryMissionEventRepository(),
    maps: new InMemoryMapTopologyRepository([topology]),
    infrastructureResources,
    traffic: new InMemoryTrafficPlanRepository(),
    trafficRestrictions: new InMemoryTrafficRestrictionRepository(),
    workflows: new InMemoryWorkflowRepository(),
    workflowResourceReservations: new InMemoryWorkflowResourceReservationRepository(),
    transactions: new InMemoryTransactionManager(),
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
    adapter,
    dispatchPolicy: new WeightedDispatchPolicy(),
    trafficScheduler: new TrafficScheduler(),
    livenessPolicy: new RobotLivenessPolicy(),
    instanceId: "fleet-server-memory",
  });

  return { core, api: new FleetApi(core), adapter };
}

export function defaultInfrastructureResources(now = new Date()): InfrastructureResourceRecord[] {
  return [
    {
      resourceId: "DOOR-CENTER-NORTH", mapId: "plant-a@1", displayName: "Central north door",
      type: "DOOR", status: "AVAILABLE", reservationPolicy: "TRANSIT_EXCLUSIVE",
      edgeId: "E-CENTER-NORTH", nodeId: null, createdBy: "system-bootstrap", createdAt: now,
      updatedBy: "system-bootstrap", updatedAt: now, statusReason: null,
    },
    {
      resourceId: "CHARGER-C-02", mapId: "plant-a@1", displayName: "Charger C-02",
      type: "CHARGER", status: "AVAILABLE", reservationPolicy: "SERVICE_EXCLUSIVE",
      edgeId: null, nodeId: "N-CHARGER-C-02", createdBy: "system-bootstrap", createdAt: now,
      updatedBy: "system-bootstrap", updatedAt: now, statusReason: null,
    },
  ];
}
