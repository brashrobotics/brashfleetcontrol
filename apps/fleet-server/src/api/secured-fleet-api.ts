import { randomUUID } from "node:crypto";
import type { AuditEventRecord, AuditRepository } from "@brash/application";
import type { AuditEventView, FleetPermission } from "@brash/contracts";
import type { OperationalAnalyticsView } from "@brash/contracts";
import type { MetricsRegistry, StructuredLogger } from "@brash/observability";
import type { FleetApi } from "./fleet-api.js";
import { hasPermission, type FleetPrincipal, type IdentityProvider } from "../modules/identity/access-control.js";

interface SecurityDependencies {
  identities: IdentityProvider;
  audit: AuditRepository;
  now?: () => Date;
  nextAuditEventId?: () => string;
  observability?: {
    metrics: MetricsRegistry;
    logger: StructuredLogger;
    collectOperationalAnalytics?: () => Promise<OperationalAnalyticsView>;
  };
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
    const startedAt = performance.now();
    let actorId = "anonymous";
    const route = routeTemplate(url.pathname);
    this.security.observability?.metrics.incrementGauge("brash_http_requests_in_flight", "Current Fleet API requests in flight.", {}, 1);
    const finish = (response: Response): Response => {
      const durationSeconds = (performance.now() - startedAt) / 1_000;
      const labels = { method: request.method, route, status: String(response.status) };
      const observability = this.security.observability;
      observability?.metrics.incrementCounter("brash_http_requests_total", "Fleet API requests by method, normalized route, and status.", labels);
      observability?.metrics.observeHistogram("brash_http_request_duration_seconds", "Fleet API request duration in seconds.", { method: request.method, route }, durationSeconds);
      observability?.metrics.incrementGauge("brash_http_requests_in_flight", "Current Fleet API requests in flight.", {}, -1);
      const context = { correlationId, actorId, method: request.method, route, path: url.pathname, status: response.status, durationMs: Math.round(durationSeconds * 100_000) / 100 };
      if (response.status >= 500) observability?.logger.error("http.request.completed", context);
      else if (response.status >= 400) observability?.logger.warn("http.request.completed", context);
      else if (request.method === "GET" || request.method === "HEAD") observability?.logger.debug("http.request.completed", context);
      else observability?.logger.info("http.request.completed", context);
      return withCorrelation(response, correlationId);
    };
    try {
    if (request.method === "OPTIONS" || (request.method === "GET" && url.pathname === "/api/v1/health")) {
      return finish(await this.inner.fetch(request));
    }

    const principal = await this.security.identities.authenticate(request.headers.get("authorization"));
    actorId = principal?.subjectId ?? "anonymous";
    const rule = authorizationRule(request.method, url.pathname);
    const siteId = request.headers.get("x-fleet-site");
    if (!principal) {
      if (rule.mutation) await this.audit(rule, null, "DENIED", request, correlationId, siteId, { reason: "AUTHENTICATION_REQUIRED" });
      return finish(errorResponse(401, "AUTHENTICATION_REQUIRED", "A valid Fleet API bearer token is required.", {
        "www-authenticate": 'Bearer realm="brash-fleet"',
      }));
    }
    if (!hasPermission(principal, rule.permission, siteId)) {
      if (rule.mutation) await this.audit(rule, principal, "DENIED", request, correlationId, siteId, { reason: "PERMISSION_DENIED", permission: rule.permission });
      return finish(errorResponse(403, "PERMISSION_DENIED", `Permission ${rule.permission} is required.`));
    }

    if (request.method === "GET" && url.pathname === "/api/v1/identity/me") {
      return finish(Response.json({ identity: principal }, { headers: { "cache-control": "no-store" } }));
    }
    if (request.method === "GET" && url.pathname === "/api/v1/audit/events") {
      const events = await this.security.audit.list({
        limit: boundedLimit(url.searchParams.get("limit")),
        actorId: optionalQuery(url, "actorId"),
        targetType: optionalQuery(url, "targetType"),
        targetId: optionalQuery(url, "targetId"),
        correlationId: optionalQuery(url, "correlationId"),
      });
      return finish(Response.json({ events: events.map(toView) }, { headers: { "cache-control": "no-store" } }));
    }
    if (request.method === "GET" && url.pathname === "/api/v1/metrics") {
      const analytics = await this.security.observability?.collectOperationalAnalytics?.();
      if (analytics && this.security.observability) publishFleetMetrics(this.security.observability.metrics, analytics);
      return finish(new Response(this.security.observability?.metrics.renderPrometheus() ?? "", {
        headers: { "cache-control": "no-store", "content-type": "text/plain; version=0.0.4; charset=utf-8" },
      }));
    }

    let routedRequest = request;
    if (rule.mutation) {
      try {
        await this.audit(rule, principal, "ATTEMPTED", request, correlationId, siteId, {});
      } catch {
        return finish(errorResponse(503, "AUDIT_UNAVAILABLE", "The operation was not executed because its audit attempt could not be persisted."));
      }
      routedRequest = await bindOperatorIdentity(request, principal);
    }
    const response = await this.inner.fetch(routedRequest);
    if (rule.mutation) {
      await this.audit(rule, principal, response.ok ? "SUCCEEDED" : "FAILED", request, correlationId, siteId, {
        responseStatus: response.status,
      }).catch(() => undefined);
    }
    return finish(response);
    } catch (error) {
      this.security.observability?.logger.error("http.request.unhandled", { correlationId, actorId, method: request.method, route, error });
      return finish(errorResponse(500, "INTERNAL_ERROR", "Unexpected Fleet API failure."));
    }
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
  if (method === "GET" && pathname === "/api/v1/metrics") return rule("observability:read", "observability.metrics", "OBSERVABILITY", "metrics", false);
  if (method === "GET") return rule("fleet:read", "fleet.read", target(pathname).type, target(pathname).id, false);
  if (method === "POST" && pathname === "/api/v1/missions") return rule("mission:create", "mission.create", "MISSION", "new", true);
  if (/^\/api\/v1\/missions\/[^/]+\/dispatch$/.test(pathname)) return rule("mission:dispatch", "mission.dispatch", "MISSION", segment(pathname, -2), true);
  if (/^\/api\/v1\/missions\/[^/]+\/cancel$/.test(pathname)) return rule("mission:cancel", "mission.cancel", "MISSION", segment(pathname, -2), true);
  if (method === "POST" && pathname === "/api/v1/workflows") return rule("workflow:create", "workflow.create", "WORKFLOW", "new", true);
  if (/^\/api\/v1\/workflows\/[^/]+\/cancel$/.test(pathname)) return rule("workflow:cancel", "workflow.cancel", "WORKFLOW", segment(pathname, -2), true);
  if (method === "POST" && pathname === "/api/v1/work-orders") return rule("orchestrator:submit", "work_order.submit", "WORK_ORDER", "new", true);
  if (/^\/api\/v1\/work-orders\/[^/]+\/cancel$/.test(pathname)) return rule("orchestrator:cancel", "work_order.cancel", "WORK_ORDER", segment(pathname, -2), true);
  if (/^\/api\/v1\/alarms\/[^/]+\/acknowledge$/.test(pathname)) return rule("alarm:acknowledge", "alarm.acknowledge", "ALARM", segment(pathname, -2), true);
  if (pathname.startsWith("/api/v1/traffic/")) return rule("traffic:manage", "traffic.manage", "TRAFFIC", target(pathname).id, true);
  if (pathname.startsWith("/api/v1/map-versions")) return rule("map:manage", "map.manage", "MAP", target(pathname).id, true);
  if (pathname.startsWith("/api/v1/infrastructure/resources")) return rule("resource:manage", "resource.manage", "RESOURCE", target(pathname).id, true);
  return rule("map:manage", "api.mutate", target(pathname).type, target(pathname).id, method !== "GET" && method !== "HEAD");
}

function routeTemplate(pathname: string): string {
  return pathname
    .replace(/^\/api\/v1\/(missions|workflows|work-orders|alarms|map-versions)\/[^/]+/, "/api/v1/$1/:id")
    .replace(/^\/api\/v1\/maps\/[^/]+/, "/api/v1/maps/:id")
    .replace(/^\/api\/v1\/traffic\/restrictions\/[^/]+/, "/api/v1/traffic/restrictions/:id")
    .replace(/^\/api\/v1\/infrastructure\/resources\/[^/]+/, "/api/v1/infrastructure/resources/:id");
}

function publishFleetMetrics(metrics: MetricsRegistry, analytics: OperationalAnalyticsView): void {
  for (const [state, value] of Object.entries({ online: analytics.robots.online, degraded: analytics.robots.degraded, offline: analytics.robots.offline })) {
    metrics.setGauge("brash_fleet_robots", "Robots by canonical connection state.", { state }, value);
  }
  metrics.setGauge("brash_fleet_robot_utilization_ratio", "Fraction of registered robots reserved or executing.", {}, analytics.robots.utilizationPercent / 100);
  for (const [state, value] of Object.entries({ active: analytics.missions.active, queued: analytics.missions.queued, completed: analytics.missions.completed, failed: analytics.missions.failed, cancelled: analytics.missions.cancelled })) {
    metrics.setGauge("brash_fleet_missions", "Missions by operational state group.", { state }, value);
  }
  metrics.setGauge("brash_fleet_mission_completion_ratio", "Completed missions divided by completed plus failed missions.", {}, analytics.missions.completionRatePercent / 100);
  for (const [state, value] of Object.entries({ active: analytics.workflows.active, succeeded: analytics.workflows.succeeded, failed: analytics.workflows.failed })) {
    metrics.setGauge("brash_fleet_workflows", "Workflows by operational state group.", { state }, value);
  }
  metrics.setGauge("brash_fleet_workflow_retries", "Total workflow step retries currently represented in durable history.", {}, analytics.workflows.retryCount);
  for (const [state, value] of Object.entries({ pending: analytics.workOrders.pending, allocated: analytics.workOrders.allocated, running: analytics.workOrders.running, succeeded: analytics.workOrders.succeeded, failed: analytics.workOrders.failed })) {
    metrics.setGauge("brash_fleet_work_orders", "High-level work orders by orchestrator state.", { state }, value);
  }
  metrics.setGauge("brash_fleet_traffic_active_routes", "Active or safety-held traffic routes.", {}, analytics.traffic.activeRoutes);
  metrics.setGauge("brash_fleet_traffic_active_reservations", "Active or safety-held traffic resource reservations.", {}, analytics.traffic.activeReservations);
  metrics.setGauge("brash_fleet_traffic_scheduled_wait_seconds", "Total planned wait on active routes.", {}, analytics.traffic.scheduledWaitSeconds);
  for (const [state, value] of Object.entries({ open: analytics.alarms.open, acknowledged: analytics.alarms.acknowledged, critical: analytics.alarms.critical, warning: analytics.alarms.warning })) {
    metrics.setGauge("brash_fleet_alarms", "Active alarms by status or severity group.", { state }, value);
  }
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
