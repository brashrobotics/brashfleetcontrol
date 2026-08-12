import {
  FleetCore,
  RandomIdGenerator,
  SystemClock,
  WeightedDispatchPolicy,
} from "@brash/application";
import type { DatabaseConfig } from "@brash/config";
import { PostgresPersistence } from "@brash/persistence";
import { FleetApi } from "../api/fleet-api.js";
import { createDevelopmentAdapter } from "./create-development-system.js";

export async function createPostgresDevelopmentSystem(config: DatabaseConfig) {
  const persistence = new PostgresPersistence(config);
  try {
    await persistence.migrate();
    const adapter = createDevelopmentAdapter();
    const core = new FleetCore({
      missions: persistence.missions,
      robots: persistence.robots,
      commands: persistence.commands,
      decisions: persistence.decisions,
      transactions: persistence.transactions,
      clock: new SystemClock(),
      ids: new RandomIdGenerator(),
      adapter,
      dispatchPolicy: new WeightedDispatchPolicy(),
    });

    return { core, api: new FleetApi(core), adapter, persistence };
  } catch (error) {
    await persistence.close();
    throw error;
  }
}
