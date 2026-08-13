import { ContractValidationError, parseAlarmActionRequest, parseCreateMissionRequest, parseCreateTrafficRestrictionRequest } from "@brash/contracts";
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
          robots: snapshot.robots.length,
          missions: snapshot.missions.length,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/fleet/snapshot") {
        return json(await this.core.getSnapshot());
      }

      if (request.method === "GET" && url.pathname === "/api/v1/dispatch/queue") {
        return json({ queue: await this.core.getDispatchQueue() });
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
