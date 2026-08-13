import { FleetCore, WeightedDispatchPolicy, WorkOrderAllocationPolicy, createDefaultPlantTopology, type FleetRecoveryOptions } from "@brash/application";
import { RobotLivenessPolicy, TrafficScheduler } from "@brash/domain";
import { SimulatorAdapter } from "@brash/simulator-adapter";
import type { SimulatorRobotDefinition } from "@brash/simulator-adapter";
import {
  InMemoryAssignmentDecisionRepository,
  InMemoryAlarmRepository,
  InMemoryCommandRepository,
  InMemoryCapabilityProfileRepository,
  InMemoryInfrastructureResourceRepository,
  InMemoryIntegrationEventRepository,
  InMemoryMissionEventRepository,
  InMemoryMissionQueueRepository,
  InMemoryMissionRepository,
  InMemoryMapTopologyRepository,
  InMemoryRobotRepository,
  InMemoryTransactionManager,
  InMemoryTrafficPlanRepository,
  InMemoryTrafficRestrictionRepository,
  InMemoryWorkflowRepository,
  InMemoryWorkflowTemplateRepository,
  InMemoryWorkflowResourceReservationRepository,
  InMemoryWorkOrderRepository,
} from "@brash/persistence";
import { ManualClock, SequentialIdGenerator } from "./fakes.js";
import { robotFixture } from "./fixtures.js";

export function createTestFleetSystem(options: {
  autoAdvance?: boolean;
  robots?: SimulatorRobotDefinition[];
  coreOptions?: FleetRecoveryOptions;
  siteId?: string;
} = {}) {
  const clock = new ManualClock();
  const ids = new SequentialIdGenerator();
  const adapter = new SimulatorAdapter(options.robots ?? [
    robotFixture({
      robotId: "BR-01",
      displayName: "Atlas",
      capabilities: ["pallet_transport"],
      maxPayloadKg: 500,
      batteryPercent: 70,
      x: 40,
      y: 5,
    }),
    robotFixture({
      robotId: "BR-02",
      displayName: "Nova",
      capabilities: ["box_transport"],
      maxPayloadKg: 100,
      batteryPercent: 90,
      x: 10,
      y: 5,
    }),
  ], {
    now: () => clock.now(),
    autoAdvance: options.autoAdvance ?? false,
  });
  const missions = new InMemoryMissionRepository();
  const alarms = new InMemoryAlarmRepository();
  const missionQueue = new InMemoryMissionQueueRepository();
  const robots = new InMemoryRobotRepository();
  const commands = new InMemoryCommandRepository();
  const capabilityProfiles = new InMemoryCapabilityProfileRepository();
  const decisions = new InMemoryAssignmentDecisionRepository();
  const events = new InMemoryMissionEventRepository();
  const maps = new InMemoryMapTopologyRepository([createDefaultPlantTopology()]);
  const infrastructureResources = new InMemoryInfrastructureResourceRepository();
  const integrationEvents = new InMemoryIntegrationEventRepository();
  const traffic = new InMemoryTrafficPlanRepository();
  const trafficRestrictions = new InMemoryTrafficRestrictionRepository();
  const workflows = new InMemoryWorkflowRepository();
  const workflowTemplates = new InMemoryWorkflowTemplateRepository();
  const workflowResourceReservations = new InMemoryWorkflowResourceReservationRepository();
  const workOrders = new InMemoryWorkOrderRepository();
  const transactions = new InMemoryTransactionManager();
  const core = new FleetCore({
    siteId: options.siteId ?? "plant-a",
    alarms,
    missions,
    missionQueue,
    robots,
    commands,
    decisions,
    events,
    maps,
    infrastructureResources,
    integrationEvents,
    traffic,
    trafficRestrictions,
    workflows,
    workflowTemplates,
    workflowResourceReservations,
    workOrders,
    capabilityProfiles,
    transactions,
    clock,
    ids,
    adapter,
    dispatchPolicy: new WeightedDispatchPolicy(),
    trafficScheduler: new TrafficScheduler(),
    workOrderAllocationPolicy: new WorkOrderAllocationPolicy(),
    livenessPolicy: new RobotLivenessPolicy(),
    instanceId: "test-fleet-core",
  }, options.coreOptions);

  return { core, adapter, clock, ids, alarms, missions, missionQueue, robots, commands, capabilityProfiles, decisions, events, maps, infrastructureResources, integrationEvents, traffic, trafficRestrictions, workflows, workflowTemplates, workflowResourceReservations, workOrders, transactions };
}
