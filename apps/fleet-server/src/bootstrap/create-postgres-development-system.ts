import {
  FleetCore,
  FleetLeaderElection,
  RandomIdGenerator,
  SystemClock,
  WeightedDispatchPolicy,
  WorkOrderAllocationPolicy,
  createDefaultPlantTopology,
} from "@brash/application";
import { RobotLivenessPolicy, TrafficScheduler } from "@brash/domain";
import { randomUUID } from "node:crypto";
import type { DatabaseConfig } from "@brash/config";
import { PostgresPersistence } from "@brash/persistence";
import { MetricsRegistry, StructuredLogger } from "@brash/observability";
import { FleetApi } from "../api/fleet-api.js";
import { SecuredFleetApi } from "../api/secured-fleet-api.js";
import { createConfiguredIdentityProvider } from "../modules/identity/access-control.js";
import { createDevelopmentAdapter, defaultInfrastructureResources } from "./create-development-system.js";

export async function createPostgresDevelopmentSystem(config: DatabaseConfig, siteId = "plant-a") {
  const persistence = new PostgresPersistence(config);
  try {
    await persistence.migrate();
    await persistence.bindSite(siteId);
    await persistence.maps.save(createDefaultPlantTopology());
    for (const resource of defaultInfrastructureResources()) {
      if (!await persistence.infrastructureResources.getById(resource.resourceId)) {
        await persistence.infrastructureResources.create(resource);
      }
    }
    const adapter = createDevelopmentAdapter();
    const clock = new SystemClock();
    const instanceId = `fleet-server-${randomUUID()}`;
    const leaderLeaseMs = Number(process.env.FLEET_LEADER_LEASE_MS ?? 15_000);
    const leaderElection = new FleetLeaderElection(persistence.leaderLeases, clock, {
      resourceName: `site:${siteId}:control-plane`,
      ownerId: instanceId,
      leaseDurationMs: Number.isInteger(leaderLeaseMs) && leaderLeaseMs >= 1_000 ? leaderLeaseMs : 15_000,
    });
    const core = new FleetCore({
      siteId,
      alarms: persistence.alarms,
      missions: persistence.missions,
      missionQueue: persistence.missionQueue,
      robots: persistence.robots,
      commands: persistence.commands,
      decisions: persistence.decisions,
      events: persistence.events,
      maps: persistence.maps,
      infrastructureResources: persistence.infrastructureResources,
      integrationEvents: persistence.integrationEvents,
      traffic: persistence.traffic,
      trafficRestrictions: persistence.trafficRestrictions,
      workflows: persistence.workflows,
      workflowTemplates: persistence.workflowTemplates,
      workflowResourceReservations: persistence.workflowResourceReservations,
      workOrders: persistence.workOrders,
      capabilityProfiles: persistence.capabilityProfiles,
      transactions: persistence.transactions,
      clock,
      ids: new RandomIdGenerator(),
      adapter,
      dispatchPolicy: new WeightedDispatchPolicy(),
      trafficScheduler: new TrafficScheduler(),
      workOrderAllocationPolicy: new WorkOrderAllocationPolicy(),
      livenessPolicy: new RobotLivenessPolicy(),
      instanceId,
    });

    const metrics = new MetricsRegistry();
    const logger = new StructuredLogger("brash-fleet-core");
    const api = new SecuredFleetApi(new FleetApi(core, async () => ({
      persistenceReady: await persistence.database.ping(),
      leadership: leaderElection.status,
    })), {
      siteId,
      identities: createConfiguredIdentityProvider(),
      audit: persistence.audit,
      observability: { metrics, logger, collectOperationalAnalytics: () => core.getOperationalAnalytics() },
    });
    return { core, api, adapter, persistence, integrationEvents: persistence.integrationEvents, leaderElection, metrics, logger };
  } catch (error) {
    await persistence.close();
    throw error;
  }
}
