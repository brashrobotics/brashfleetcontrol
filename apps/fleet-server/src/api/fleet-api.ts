import {
  ContractValidationError,
  parseAlarmActionRequest,
  parseAssignCapabilityProfileRequest,
  parseCreateCapabilityProfileRequest,
  parseCreateInfrastructureResourceRequest,
  parseCreateMapVersionRequest,
  parseCreateMissionRequest,
  parseCreateTrafficRestrictionRequest,
  parseCreateWorkflowRequest,
  parseCreateWorkOrderRequest,
  parseQuarantineRobotRequest,
  parseReassignRecoveryMissionRequest,
  parseReleaseRobotQuarantineRequest,
  parseUpdateInfrastructureResourceStatusRequest,
} from "@brash/contracts";
import { DomainError } from "@brash/domain";
import type { FleetCore } from "@brash/application";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export class FleetApi {
  constructor(private readonly core: FleetCore) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/v1/health") {
        const snapshot = await this.core.getSnapshot();
        return json({
          ok: true,
          service: "brash-fleet-core",
          siteId: this.core.siteId,
          robots: snapshot.robots.length,
          missions: snapshot.missions.length,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/fleet/snapshot") {
        return json(await this.core.getSnapshot());
      }

      if (request.method === "GET" && url.pathname === "/api/v1/analytics/operations") {
        return json({ analytics: await this.core.getOperationalAnalytics() });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/dispatch/queue") {
        return json({ queue: await this.core.getDispatchQueue() });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/workflows") {
        return json({ workflows: await this.core.listWorkflows() });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/work-orders") {
        return json({ workOrders: await this.core.listWorkOrders() });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/integrations/events") {
        const status = url.searchParams.get("status");
        if (status && !["PENDING", "DELIVERED", "DEAD_LETTER"].includes(status)) {
          return json({ error: { code: "INTEGRATION_STATUS_INVALID", message: "status must be PENDING, DELIVERED, or DEAD_LETTER." } }, 400);
        }
        const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
        return json({ events: await this.core.listIntegrationEvents({
          ...(status ? { status: status as "PENDING" | "DELIVERED" | "DEAD_LETTER" } : {}),
          ...(url.searchParams.get("aggregateType") ? { aggregateType: url.searchParams.get("aggregateType")! } : {}),
          ...(url.searchParams.get("aggregateId") ? { aggregateId: url.searchParams.get("aggregateId")! } : {}),
          limit: Number.isInteger(requestedLimit) ? requestedLimit : 100,
        }) });
      }

      const integrationRedriveMatch = url.pathname.match(/^\/api\/v1\/integrations\/events\/([^/]+)\/redrive$/);
      if (request.method === "POST" && integrationRedriveMatch) {
        return json({ event: await this.core.redriveIntegrationEvent(decodeURIComponent(integrationRedriveMatch[1])) });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/capability-profiles") {
        return json({ profiles: await this.core.listCapabilityProfiles() });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/capability-profiles") {
        return json({ profile: await this.core.createCapabilityProfile(parseCreateCapabilityProfileRequest(await request.json())) }, 201);
      }

      const capabilityLifecycleMatch = url.pathname.match(/^\/api\/v1\/capability-profiles\/([^/]+)\/(publish|retire)$/);
      if (request.method === "POST" && capabilityLifecycleMatch) {
        const input = parseAlarmActionRequest(await request.json());
        const profileId = decodeURIComponent(capabilityLifecycleMatch[1]);
        const profile = capabilityLifecycleMatch[2] === "publish"
          ? await this.core.publishCapabilityProfile(profileId, input.operatorId)
          : await this.core.retireCapabilityProfile(profileId, input.operatorId);
        return json({ profile });
      }

      const capabilityAssignmentMatch = url.pathname.match(/^\/api\/v1\/robots\/([^/]+)\/capability-profile$/);
      if (request.method === "POST" && capabilityAssignmentMatch) {
        const input = parseAssignCapabilityProfileRequest(await request.json());
        return json({ robot: await this.core.assignRobotCapabilityProfile(decodeURIComponent(capabilityAssignmentMatch[1]), input.profileId, input.operatorId) });
      }

      const robotQuarantineMatch = url.pathname.match(/^\/api\/v1\/robots\/([^/]+)\/(quarantine|release-quarantine)$/);
      if (request.method === "POST" && robotQuarantineMatch) {
        const robotId = decodeURIComponent(robotQuarantineMatch[1]);
        const robot = robotQuarantineMatch[2] === "quarantine"
          ? await this.core.quarantineRobot(robotId, parseQuarantineRobotRequest(await request.json()))
          : await this.core.releaseRobotQuarantine(robotId, parseReleaseRobotQuarantineRequest(await request.json()));
        return json({ robot });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/work-orders") {
        const input = parseCreateWorkOrderRequest(await request.json());
        return json({ workOrder: await this.core.createWorkOrder(input) }, 201);
      }

      const workOrderCancellationMatch = url.pathname.match(/^\/api\/v1\/work-orders\/([^/]+)\/cancel$/);
      if (request.method === "POST" && workOrderCancellationMatch) {
        return json({ workOrder: await this.core.cancelWorkOrder(decodeURIComponent(workOrderCancellationMatch[1])) });
      }

      const workOrderMatch = url.pathname.match(/^\/api\/v1\/work-orders\/([^/]+)$/);
      if (request.method === "GET" && workOrderMatch) {
        return json({ workOrder: await this.core.getWorkOrder(decodeURIComponent(workOrderMatch[1])) });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/workflows") {
        const input = parseCreateWorkflowRequest(await request.json());
        return json({ workflow: await this.core.createWorkflow(input) }, 201);
      }

      const workflowCancellationMatch = url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/cancel$/);
      if (request.method === "POST" && workflowCancellationMatch) {
        return json({ workflow: await this.core.cancelWorkflow(decodeURIComponent(workflowCancellationMatch[1])) });
      }

      const workflowMatch = url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
      if (request.method === "GET" && workflowMatch) {
        return json({ workflow: await this.core.getWorkflow(decodeURIComponent(workflowMatch[1])) });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/alarms") {
        return json({ summary: await this.core.getAlarms() });
      }

      const alarmAcknowledgeMatch = url.pathname.match(/^\/api\/v1\/alarms\/([^/]+)\/acknowledge$/);
      if (request.method === "POST" && alarmAcknowledgeMatch) {
        const input = parseAlarmActionRequest(await request.json());
        const alarm = await this.core.acknowledgeAlarm(
          decodeURIComponent(alarmAcknowledgeMatch[1]),
          input.operatorId,
          input.note,
        );
        return json({ alarm });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/maps") {
        return json({ maps: await this.core.listMapTopologies() });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/map-versions") {
        return json({ versions: await this.core.listMapVersions(url.searchParams.get("familyId") ?? undefined) });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/map-versions") {
        const input = parseCreateMapVersionRequest(await request.json());
        return json({ version: await this.core.createMapVersion(input) }, 201);
      }

      const mapPublicationMatch = url.pathname.match(/^\/api\/v1\/map-versions\/([^/]+)\/(publish|retire)$/);
      if (request.method === "POST" && mapPublicationMatch) {
        const input = parseAlarmActionRequest(await request.json());
        const mapId = decodeURIComponent(mapPublicationMatch[1]);
        const version = mapPublicationMatch[2] === "publish"
          ? await this.core.publishMapVersion(mapId, input.operatorId)
          : await this.core.retireMapVersion(mapId, input.operatorId);
        return json({ version });
      }

      const mapTopologyMatch = url.pathname.match(/^\/api\/v1\/maps\/([^/]+)\/topology$/);
      if (request.method === "GET" && mapTopologyMatch) {
        return json({ topology: await this.core.getMapTopology(decodeURIComponent(mapTopologyMatch[1])) });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/traffic/schedule") {
        const mapId = url.searchParams.get("mapId");
        if (!mapId) {
          return json({ error: { code: "MAP_ID_REQUIRED", message: "The mapId query parameter is required." } }, 400);
        }
        return json({ schedule: await this.core.getTrafficSchedule(mapId) });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/traffic/restrictions") {
        const mapId = url.searchParams.get("mapId");
        if (!mapId) return json({ error: { code: "MAP_ID_REQUIRED", message: "The mapId query parameter is required." } }, 400);
        return json({ restrictions: await this.core.listTrafficRestrictions(mapId) });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/infrastructure/resources") {
        const mapId = url.searchParams.get("mapId");
        if (!mapId) return json({ error: { code: "MAP_ID_REQUIRED", message: "The mapId query parameter is required." } }, 400);
        return json({ resources: await this.core.listInfrastructureResources(mapId) });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/infrastructure/resources") {
        const input = parseCreateInfrastructureResourceRequest(await request.json());
        return json({ resource: await this.core.createInfrastructureResource(input) }, 201);
      }

      const infrastructureStatusMatch = url.pathname.match(/^\/api\/v1\/infrastructure\/resources\/([^/]+)\/status$/);
      if (request.method === "POST" && infrastructureStatusMatch) {
        const input = parseUpdateInfrastructureResourceStatusRequest(await request.json());
        return json({ resource: await this.core.updateInfrastructureResourceStatus(
          decodeURIComponent(infrastructureStatusMatch[1]), input.status, input.reason, input.operatorId,
        ) });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/traffic/restrictions") {
        const input = parseCreateTrafficRestrictionRequest(await request.json());
        return json({ restriction: await this.core.createTrafficRestriction(input) }, 201);
      }

      const clearRestrictionMatch = url.pathname.match(/^\/api\/v1\/traffic\/restrictions\/([^/]+)\/clear$/);
      if (request.method === "POST" && clearRestrictionMatch) {
        const input = parseAlarmActionRequest(await request.json());
        return json({ restriction: await this.core.clearTrafficRestriction(decodeURIComponent(clearRestrictionMatch[1]), input.operatorId) });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/recovery/status") {
        return json({ recovery: await this.core.getRecoveryStatus() });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/missions") {
        const input = parseCreateMissionRequest(await request.json());
        const mission = await this.core.createMission(input);
        if (input.autoDispatch === false) return json({ mission }, 201);
        if (mission.state !== "QUEUED") return json({ mission, dispatch: null }, 200);
        const dispatch = await this.core.dispatchMission(mission.missionId);
        return json({ mission: dispatch.mission, dispatch }, 201);
      }

      const missionEventsMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/events$/);
      if (request.method === "GET" && missionEventsMatch) {
        return json({ events: await this.core.getMissionEvents(decodeURIComponent(missionEventsMatch[1])) });
      }

      const missionRouteMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/route$/);
      if (request.method === "GET" && missionRouteMatch) {
        return json({ route: await this.core.getMissionRoute(decodeURIComponent(missionRouteMatch[1])) });
      }

      const missionMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)$/);
      if (request.method === "GET" && missionMatch) {
        return json({ mission: await this.core.getMission(decodeURIComponent(missionMatch[1])) });
      }

      const dispatchMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/dispatch$/);
      if (request.method === "POST" && dispatchMatch) {
        return json({ dispatch: await this.core.dispatchMission(decodeURIComponent(dispatchMatch[1])) });
      }

      const cancellationMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancellationMatch) {
        const cancellation = await this.core.cancelMission(decodeURIComponent(cancellationMatch[1]));
        return json({ cancellation }, cancellation.mission.state === "CANCELLED" ? 200 : 202);
      }

      const recoveryReassignmentMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/reassign-recovery$/);
      if (request.method === "POST" && recoveryReassignmentMatch) {
        const input = parseReassignRecoveryMissionRequest(await request.json());
        return json({ dispatch: await this.core.reassignRecoveryMission(decodeURIComponent(recoveryReassignmentMatch[1]), input) });
      }

      return json({ error: { code: "NOT_FOUND", message: "Fleet API endpoint was not found." } }, 404);
    } catch (error) {
      return this.mapError(error);
    }
  }

  private mapError(error: unknown): Response {
    if (error instanceof ContractValidationError) {
      return json({
        error: {
          code: "CONTRACT_VALIDATION_FAILED",
          message: error.message,
          issues: error.issues,
        },
      }, 400);
    }
    if (error instanceof DomainError) {
      const status = error.code.endsWith("NOT_FOUND") ? 404 : 409;
      return json({ error: { code: error.code, message: error.message } }, status);
    }
    if (error instanceof SyntaxError) {
      return json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON." } }, 400);
    }

    return json({
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected Fleet API failure.",
      },
    }, 500);
  }
}
