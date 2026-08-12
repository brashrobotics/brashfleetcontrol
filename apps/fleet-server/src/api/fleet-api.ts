import { ContractValidationError, parseCreateMissionRequest } from "@brash/contracts";
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

      if (request.method === "POST" && url.pathname === "/api/v1/missions") {
        const input = parseCreateMissionRequest(await request.json());
        const mission = await this.core.createMission(input);
        if (input.autoDispatch === false) return json({ mission }, 201);
        if (mission.state !== "QUEUED") return json({ mission, dispatch: null }, 200);
        const dispatch = await this.core.dispatchMission(mission.missionId);
        return json({ mission: dispatch.mission, dispatch }, 201);
      }

      const missionMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)$/);
      if (request.method === "GET" && missionMatch) {
        return json({ mission: await this.core.getMission(decodeURIComponent(missionMatch[1])) });
      }

      const dispatchMatch = url.pathname.match(/^\/api\/v1\/missions\/([^/]+)\/dispatch$/);
      if (request.method === "POST" && dispatchMatch) {
        return json({ dispatch: await this.core.dispatchMission(decodeURIComponent(dispatchMatch[1])) });
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
