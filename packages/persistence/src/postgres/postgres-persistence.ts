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
  PostgresIntegrationEventRepository,
  PostgresLeaderLeaseRepository,
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
  readonly integrationEvents: PostgresIntegrationEventRepository;
  readonly leaderLeases: PostgresLeaderLeaseRepository;
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
    this.integrationEvents = new PostgresIntegrationEventRepository(this.database);
    this.leaderLeases = new PostgresLeaderLeaseRepository(this.database);
    this.traffic = new PostgresTrafficPlanRepository(this.database);
    this.trafficRestrictions = new PostgresTrafficRestrictionRepository(this.database);
    this.workflows = new PostgresWorkflowRepository(this.database);
    this.workflowResourceReservations = new PostgresWorkflowResourceReservationRepository(this.database);
    this.workOrders = new PostgresWorkOrderRepository(this.database);
    this.transactions = new PostgresTransactionManager(this.database);
  }

  async migrate(): Promise<void> {
    await this.database.ensureSchema();
    await runPostgresMigrations(this.database, { timeoutMs: this.startupTimeoutMs });
  }

  async bindSite(siteId: string): Promise<void> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteId)) throw new Error("Invalid Fleet site binding identifier.");
    await this.database.transaction(async () => {
      await this.database.query("INSERT INTO fleet_site_binding (singleton, site_id) VALUES (true, $1) ON CONFLICT (singleton) DO NOTHING", [siteId]);
      const result = await this.database.query<{ site_id: string }>("SELECT site_id FROM fleet_site_binding WHERE singleton=true");
      if (result.rows[0]?.site_id !== siteId) {
        throw new Error(`Database schema ${this.database.schema} is bound to site ${result.rows[0]?.site_id ?? "unknown"}, not ${siteId}.`);
      }
    });
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}
