import type { DatabaseConfig } from "@brash/config";
import { runPostgresMigrations } from "./migrations.js";
import { PostgresDatabase } from "./postgres-database.js";
import {
  PostgresAssignmentDecisionRepository,
  PostgresCommandRepository,
  PostgresMapTopologyRepository,
  PostgresMissionEventRepository,
  PostgresMissionRepository,
  PostgresRobotRepository,
  PostgresTrafficPlanRepository,
} from "./postgres-repositories.js";
import { PostgresTransactionManager } from "./postgres-transaction-manager.js";

export class PostgresPersistence {
  readonly database: PostgresDatabase;
  readonly missions: PostgresMissionRepository;
  readonly robots: PostgresRobotRepository;
  readonly commands: PostgresCommandRepository;
  readonly decisions: PostgresAssignmentDecisionRepository;
  readonly events: PostgresMissionEventRepository;
  readonly maps: PostgresMapTopologyRepository;
  readonly traffic: PostgresTrafficPlanRepository;
  readonly transactions: PostgresTransactionManager;
  private readonly startupTimeoutMs: number;

  constructor(config: DatabaseConfig) {
    this.startupTimeoutMs = config.startupTimeoutMs;
    this.database = new PostgresDatabase(config);
    this.missions = new PostgresMissionRepository(this.database);
    this.robots = new PostgresRobotRepository(this.database);
    this.commands = new PostgresCommandRepository(this.database);
    this.decisions = new PostgresAssignmentDecisionRepository(this.database);
    this.events = new PostgresMissionEventRepository(this.database);
    this.maps = new PostgresMapTopologyRepository(this.database);
    this.traffic = new PostgresTrafficPlanRepository(this.database);
    this.transactions = new PostgresTransactionManager(this.database);
  }

  async migrate(): Promise<void> {
    await runPostgresMigrations(this.database, { timeoutMs: this.startupTimeoutMs });
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}
