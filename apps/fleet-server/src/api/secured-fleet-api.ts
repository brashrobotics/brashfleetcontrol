import { randomUUID } from "node:crypto";
import type { AuditEventRecord, AuditRepository } from "@brash/application";
import type { AuditEventView, FleetPermission } from "@brash/contracts";
import type { FleetApi } from "./fleet-api.js";
import { hasPermission, type FleetPrincipal, type IdentityProvider } from "../modules/identity/access-control.js";

interface SecurityDependencies {
  identities: IdentityProvider;
  audit: AuditRepository;
  now?: () => Date;
  nextAuditEventId?: () => string;
}

interface AuthorizationRule {
  permission: FleetPermission;
  action: string;
  targetType: string;
  targetId: string;
  mutation: boolean;
}

export class SecuredFleetApi {
  private readonly now: () => Date;
  private readonly nextAuditEventId: () => string;

  constructor(private readonly inner: FleetApi, private readonly security: SecurityDependencies) {
    this.now = security.now ?? (() => new Date());
    this.nextAuditEventId = security.nextAuditEventId ?? (() => randomUUID());
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const correlationId = validCorrelationId(request.headers.get("x-correlation-id")) ?? randomUUID();
    if (request.method === "OPTIONS" || (request.method === "GET" && url.pathname === "/api/v1/health")) {
      return withCorrelation(await this.inner.fetch(request), correlationId);
    }

    const principal = await this.security.identities.authenticate(request.headers.get("authorization"));
    const rule = authorizationRule(request.method, url.pathname);
    const siteId = request.headers.get("x-fleet-site");
    if (!principal) {
      if (rule.mutation) await this.audit(rule, null, "DENIED", request, correlationId, siteId, { reason: "AUTHENTICATION_REQUIRED" });
      return withCorrelation(errorResponse(401, "AUTHENTICATION_REQUIRED", "A valid Fleet API bearer token is required.", {
        "www-authenticate": 'Bearer realm="brash-fleet"',
      }), correlationId);
    }
    if (!hasPermission(principal, rule.permission, siteId)) {
      if (rule.mutation) await this.audit(rule, principal, "DENIED", request, correlationId, siteId, { reason: "PERMISSION_DENIED", permission: rule.permission });
      return withCorrelation(errorResponse(403, "PERMISSION_DENIED", `Permission ${rule.permission} is required.`), correlationId);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/identity/me") {
      return withCorrelation(Response.json({ identity: principal }, { headers: { "cache-control": "no-store" } }), correlationId);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/audit/events") {
      const events = await this.security.audit.list({
        limit: boundedLimit(url.searchParams.get("limit")),
        actorId: optionalQuery(url, "actorId"),
        targetType: optionalQuery(url, "targetType"),
        targetId: optionalQuery(url, "targetId"),
        correlationId: optionalQuery(url, "correlationId"),
      });
      return withCorrelation(Response.json({ events: events.map(toView) }, { headers: { "cache-control": "no-store" } }), correlationId);
    }

    let routedRequest = request;
    if (rule.mutation) {
      try {
        await this.audit(rule, principal, "ATTEMPTED", request, correlationId, siteId, {});
      } catch {
        return withCorrelation(errorResponse(503, "AUDIT_UNAVAILABLE", "The operation was not executed because its audit attempt could not be persisted."), correlationId);
      }
      routedRequest = await bindOperatorIdentity(request, principal);
    }
    const response = await this.inner.fetch(routedRequest);
    if (rule.mutation) {
      await this.audit(rule, principal, response.ok ? "SUCCEEDED" : "FAILED", request, correlationId, siteId, {
        responseStatus: response.status,
      }).catch(() => undefined);
    }
    return withCorrelation(response, correlationId);
  }

  private async audit(
    rule: AuthorizationRule,
    principal: FleetPrincipal | null,
    outcome: AuditEventRecord["outcome"],
    request: Request,
    correlationId: string,
    siteId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.security.audit.append({
      auditEventId: this.nextAuditEventId(),
      occurredAt: this.now(),
      actorId: principal?.subjectId ?? "anonymous",
      actorDisplayName: principal?.displayName ?? "Unauthenticated request",
      actorRole: principal?.role ?? null,
      action: rule.action,
      targetType: rule.targetType,
      targetId: rule.targetId,
      outcome,
      correlationId,
      requestMethod: request.method,
      requestPath: new URL(request.url).pathname,
      siteId,
      metadata,
    });
  }
}

function authorizationRule(method: string, pathname: string): AuthorizationRule {
  if (method === "GET" && pathname === "/api/v1/audit/events") return rule("audit:read", "audit.list", "AUDIT", "events", false);
  if (method === "GET") return rule("fleet:read", "fleet.read", target(pathname).type, target(pathname).id, false);
  if (method === "POST" && pathname === "/api/v1/missions") return rule("mission:create", "mission.create", "MISSION", "new", true);
  if (/^\/api\/v1\/missions\/[^/]+\/dispatch$/.test(pathname)) return rule("mission:dispatch", "mission.dispatch", "MISSION", segment(pathname, -2), true);
  if (/^\/api\/v1\/missions\/[^/]+\/cancel$/.test(pathname)) return rule("mission:cancel", "mission.cancel", "MISSION", segment(pathname, -2), true);
  if (method === "POST" && pathname === "/api/v1/workflows") return rule("workflow:create", "workflow.create", "WORKFLOW", "new", true);
  if (/^\/api\/v1\/workflows\/[^/]+\/cancel$/.test(pathname)) return rule("workflow:cancel", "workflow.cancel", "WORKFLOW", segment(pathname, -2), true);
  if (/^\/api\/v1\/alarms\/[^/]+\/acknowledge$/.test(pathname)) return rule("alarm:acknowledge", "alarm.acknowledge", "ALARM", segment(pathname, -2), true);
  if (pathname.startsWith("/api/v1/traffic/")) return rule("traffic:manage", "traffic.manage", "TRAFFIC", target(pathname).id, true);
  if (pathname.startsWith("/api/v1/map-versions")) return rule("map:manage", "map.manage", "MAP", target(pathname).id, true);
  if (pathname.startsWith("/api/v1/infrastructure/resources")) return rule("resource:manage", "resource.manage", "RESOURCE", target(pathname).id, true);
  return rule("map:manage", "api.mutate", target(pathname).type, target(pathname).id, method !== "GET" && method !== "HEAD");
}

function rule(permission: FleetPermission, action: string, targetType: string, targetId: string, mutation: boolean): AuthorizationRule {
  return { permission, action, targetType, targetId, mutation };
}

function target(pathname: string): { type: string; id: string } {
  const parts = pathname.split("/").filter(Boolean);
  return { type: (parts[2] ?? "fleet").replaceAll("-", "_").toUpperCase(), id: decodeURIComponent(parts[3] ?? "collection") };
}

function segment(pathname: string, offset: number): string {
  const parts = pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts.at(offset) ?? "unknown");
}

async function bindOperatorIdentity(request: Request, principal: FleetPrincipal): Promise<Request> {
  if (!request.headers.get("content-type")?.includes("application/json")) return request;
  const body = await request.clone().json().catch(() => null) as unknown;
  if (!body || typeof body !== "object" || !("operatorId" in body)) return request;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify({ ...body, operatorId: principal.subjectId }) });
}

function validCorrelationId(value: string | null): string | null {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

function boundedLimit(value: string | null): number {
  const parsed = Number(value ?? 100);
  return Number.isInteger(parsed) ? Math.min(500, Math.max(1, parsed)) : 100;
}

function optionalQuery(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) || undefined;
}

function errorResponse(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return Response.json({ error: { code, message } }, { status, headers: { ...headers, "cache-control": "no-store" } });
}

function withCorrelation(response: Response, correlationId: string): Response {
  response.headers.set("x-correlation-id", correlationId);
  return response;
}

function toView(event: AuditEventRecord): AuditEventView {
  return { ...event, occurredAt: event.occurredAt.toISOString(), metadata: structuredClone(event.metadata) };
}
