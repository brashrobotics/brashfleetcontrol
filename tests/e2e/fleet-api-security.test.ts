import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuditRepository } from "@brash/persistence";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";
import { FleetApi } from "../../apps/fleet-server/src/api/fleet-api.js";
import { SecuredFleetApi } from "../../apps/fleet-server/src/api/secured-fleet-api.js";
import { StaticTokenIdentityProvider } from "../../apps/fleet-server/src/modules/identity/access-control.js";

const VIEWER_TOKEN = "test-viewer-token-123";
const OPERATOR_TOKEN = "test-operator-token-123";
const ADMIN_TOKEN = "test-admin-token-123";

test("secured API enforces authentication, RBAC, actor binding, and immutable audit events", async () => {
  const { core, clock } = createTestFleetSystem();
  const audit = new InMemoryAuditRepository();
  let auditId = 0;
  const api = new SecuredFleetApi(new FleetApi(core), {
    identities: new StaticTokenIdentityProvider([
      { token: VIEWER_TOKEN, subjectId: "viewer-1", displayName: "Viewer", subjectType: "USER", role: "VIEWER", siteIds: ["plant-a"] },
      { token: OPERATOR_TOKEN, subjectId: "operator-1", displayName: "Operator", subjectType: "USER", role: "OPERATOR", siteIds: ["plant-a"] },
      { token: ADMIN_TOKEN, subjectId: "admin-1", displayName: "Admin", subjectType: "USER", role: "FLEET_ADMIN", siteIds: ["*"] },
    ]),
    audit,
    now: () => clock.now(),
    nextAuditEventId: () => `audit-${++auditId}`,
  });
  await core.start();

  try {
    const unauthenticated = await api.fetch(new Request("http://fleet.test/api/v1/fleet/snapshot"));
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("www-authenticate") ?? "", /Bearer/);

    const denied = await api.fetch(authenticatedRequest("http://fleet.test/api/v1/missions", VIEWER_TOKEN, {
      method: "POST",
      body: JSON.stringify(transportMissionFixture({ externalReference: "SEC-DENIED" })),
    }));
    assert.equal(denied.status, 403);
    assert.equal((await core.getSnapshot()).missions.length, 0);

    const correlationId = "security-test-correlation";
    const restricted = await api.fetch(authenticatedRequest("http://fleet.test/api/v1/traffic/restrictions", OPERATOR_TOKEN, {
      method: "POST",
      headers: { "x-correlation-id": correlationId },
      body: JSON.stringify({
        mapId: "plant-a@1",
        resourceId: "edge:E-NORTH-02",
        reason: "Security API test",
        operatorId: "spoofed-identity",
      }),
    }));
    assert.equal(restricted.status, 201);
    assert.equal(restricted.headers.get("x-correlation-id"), correlationId);
    const restriction = await restricted.json() as { restriction: { createdBy: string } };
    assert.equal(restriction.restriction.createdBy, "operator-1");

    const operatorAuditRead = await api.fetch(authenticatedRequest("http://fleet.test/api/v1/audit/events", OPERATOR_TOKEN));
    assert.equal(operatorAuditRead.status, 403);
    const adminAuditRead = await api.fetch(authenticatedRequest(
      `http://fleet.test/api/v1/audit/events?correlationId=${correlationId}`,
      ADMIN_TOKEN,
    ));
    assert.equal(adminAuditRead.status, 200);
    const body = await adminAuditRead.json() as { events: Array<{ actorId: string; outcome: string; action: string; correlationId: string }> };
    assert.deepEqual(body.events.map((event) => event.outcome).sort(), ["ATTEMPTED", "SUCCEEDED"]);
    assert.ok(body.events.every((event) => event.actorId === "operator-1"));
    assert.ok(body.events.every((event) => event.action === "traffic.manage" && event.correlationId === correlationId));

    const deniedEvents = await audit.list({ limit: 10, actorId: "viewer-1" });
    assert.equal(deniedEvents.length, 1);
    assert.equal(deniedEvents[0].outcome, "DENIED");
  } finally {
    await core.stop();
  }
});

function authenticatedRequest(url: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-fleet-site", "plant-a");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}
