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
import { createDevelopmentAdapter } from "./create-development-system.js";

export async function createPostgresDevelopmentSystem(config: DatabaseConfig) {
  const persistence = new PostgresPersistence(config);
  try {
    await persistence.migrate();
    await persistence.maps.save(createDefaultPlantTopology());
    const adapter = createDevelopmentAdapter();
    const core = new FleetCore({
      missions: persistence.missions,
      robots: persistence.robots,
      commands: persistence.commands,
      decisions: persistence.decisions,
      events: persistence.events,
      maps: persistence.maps,
      traffic: persistence.traffic,
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
