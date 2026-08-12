import type { DatabaseConfig } from "@brash/config";
import { runPostgresMigrations } from "./migrations.js";
import { PostgresDatabase } from "./postgres-database.js";
import {
  PostgresAssignmentDecisionRepository,
  PostgresCommandRepository,
  PostgresMissionRepository,
  PostgresRobotRepository,
} from "./postgres-repositories.js";
import { PostgresTransactionManager } from "./postgres-transaction-manager.js";

export class PostgresPersistence {
  readonly database: PostgresDatabase;
  readonly missions: PostgresMissionRepository;
  readonly robots: PostgresRobotRepository;
  readonly commands: PostgresCommandRepository;
  readonly decisions: PostgresAssignmentDecisionRepository;
  readonly transactions: PostgresTransactionManager;

  constructor(config: DatabaseConfig) {
    this.database = new PostgresDatabase(config);
    this.missions = new PostgresMissionRepository(this.database);
    this.robots = new PostgresRobotRepository(this.database);
    this.commands = new PostgresCommandRepository(this.database);
    this.decisions = new PostgresAssignmentDecisionRepository(this.database);
    this.transactions = new PostgresTransactionManager(this.database);
  }

  async migrate(): Promise<void> {
    await runPostgresMigrations(this.database);
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}
