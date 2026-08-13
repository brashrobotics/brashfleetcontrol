import type { DatabaseConfig } from "@brash/config";
import { runPostgresMigrations } from "./migrations.js";
import { PostgresDatabase } from "./postgres-database.js";
import {
  PostgresAssignmentDecisionRepository,
  PostgresAuditRepository,
  PostgresAlarmRepository,
  PostgresCommandRepository,
  PostgresCapabilityProfileRepository,
  PostgresInfrastructureResourceRepository,
  PostgresMapTopologyRepository,
  PostgresMissionQueueRepository,
  PostgresMissionEventRepository,
  PostgresMissionRepository,
  PostgresRobotRepository,
  PostgresTrafficPlanRepository,
  PostgresTrafficRestrictionRepository,
  PostgresWorkflowRepository,
  PostgresWorkflowResourceReservationRepository,
  PostgresWorkOrderRepository,
} from "./postgres-repositories.js";
import { PostgresTransactionManager } from "./postgres-transaction-manager.js";

export class PostgresPersistence {
  readonly database: PostgresDatabase;
  readonly alarms: PostgresAlarmRepository;
  readonly audit: PostgresAuditRepository;
  readonly missions: PostgresMissionRepository;
  readonly missionQueue: PostgresMissionQueueRepository;
  readonly robots: PostgresRobotRepository;
  readonly commands: PostgresCommandRepository;
  readonly capabilityProfiles: PostgresCapabilityProfileRepository;
  readonly decisions: PostgresAssignmentDecisionRepository;
  readonly events: PostgresMissionEventRepository;
  readonly maps: PostgresMapTopologyRepository;
  readonly infrastructureResources: PostgresInfrastructureResourceRepository;
  readonly traffic: PostgresTrafficPlanRepository;
  readonly trafficRestrictions: PostgresTrafficRestrictionRepository;
  readonly workflows: PostgresWorkflowRepository;
  readonly workflowResourceReservations: PostgresWorkflowResourceReservationRepository;
  readonly workOrders: PostgresWorkOrderRepository;
  readonly transactions: PostgresTransactionManager;
  private readonly startupTimeoutMs: number;

  constructor(config: DatabaseConfig) {
    this.startupTimeoutMs = config.startupTimeoutMs;
    this.database = new PostgresDatabase(config);
    this.alarms = new PostgresAlarmRepository(this.database);
    this.audit = new PostgresAuditRepository(this.database);
    this.missions = new PostgresMissionRepository(this.database);
    this.missionQueue = new PostgresMissionQueueRepository(this.database);
    this.robots = new PostgresRobotRepository(this.database);
    this.commands = new PostgresCommandRepository(this.database);
    this.capabilityProfiles = new PostgresCapabilityProfileRepository(this.database);
    this.decisions = new PostgresAssignmentDecisionRepository(this.database);
    this.events = new PostgresMissionEventRepository(this.database);
    this.maps = new PostgresMapTopologyRepository(this.database);
    this.infrastructureResources = new PostgresInfrastructureResourceRepository(this.database);
    this.traffic = new PostgresTrafficPlanRepository(this.database);
    this.trafficRestrictions = new PostgresTrafficRestrictionRepository(this.database);
    this.workflows = new PostgresWorkflowRepository(this.database);
    this.workflowResourceReservations = new PostgresWorkflowResourceReservationRepository(this.database);
    this.workOrders = new PostgresWorkOrderRepository(this.database);
    this.transactions = new PostgresTransactionManager(this.database);
  }

  async migrate(): Promise<void> {
    await runPostgresMigrations(this.database, { timeoutMs: this.startupTimeoutMs });
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}
