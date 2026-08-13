import {
  FleetCore,
  RandomIdGenerator,
  SystemClock,
  WeightedDispatchPolicy,
  createDefaultPlantTopology,
} from "@brash/application";
import { RobotLivenessPolicy, TrafficScheduler } from "@brash/domain";
import { randomUUID } from "node:crypto";
import type { DatabaseConfig } from "@brash/config";
import { PostgresPersistence } from "@brash/persistence";
import { FleetApi } from "../api/fleet-api.js";
import { createDevelopmentAdapter, defaultInfrastructureResources } from "./create-development-system.js";

export async function createPostgresDevelopmentSystem(config: DatabaseConfig) {
  const persistence = new PostgresPersistence(config);
  try {
    await persistence.migrate();
    await persistence.maps.save(createDefaultPlantTopology());
    for (const resource of defaultInfrastructureResources()) {
      if (!await persistence.infrastructureResources.getById(resource.resourceId)) {
        await persistence.infrastructureResources.create(resource);
      }
    }
    const adapter = createDevelopmentAdapter();
    const core = new FleetCore({
      alarms: persistence.alarms,
      missions: persistence.missions,
      missionQueue: persistence.missionQueue,
      robots: persistence.robots,
      commands: persistence.commands,
      decisions: persistence.decisions,
      events: persistence.events,
      maps: persistence.maps,
      infrastructureResources: persistence.infrastructureResources,
      traffic: persistence.traffic,
      trafficRestrictions: persistence.trafficRestrictions,
      workflows: persistence.workflows,
      workflowResourceReservations: persistence.workflowResourceReservations,
      transactions: persistence.transactions,
      clock: new SystemClock(),
      ids: new RandomIdGenerator(),
      adapter,
      dispatchPolicy: new WeightedDispatchPolicy(),
      trafficScheduler: new TrafficScheduler(),
      livenessPolicy: new RobotLivenessPolicy(),
      instanceId: `fleet-server-${randomUUID()}`,
    });

    return { core, api: new FleetApi(core), adapter, persistence };
  } catch (error) {
    await persistence.close();
    throw error;
  }
}
