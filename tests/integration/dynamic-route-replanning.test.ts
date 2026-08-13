import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, robotFixture, transportMissionFixture } from "@brash/test-kit";

test("active route is atomically replaced by a traceable conflict-free revision", async () => {
  const system = createTestFleetSystem({
    robots: [robotFixture({ robotId: "BR-REPLAN-01", x: 10, y: 5, capabilities: ["pallet_transport"] })],
  });
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture({ externalReference: "REPLAN-001" }));
    const dispatch = await system.core.dispatchMission(mission.missionId);
    const blockedEdge = dispatch.route!.segments.find((segment) => segment.edgeId === "E-CENTER-NORTH")?.edgeId
      ?? dispatch.route!.segments.find((segment) => segment.edgeId === "E-NORTH-02")!.edgeId;
    const originalRouteId = dispatch.route!.routeId;

    const result = await system.core.replanMissionRoute(mission.missionId, {
      reason: "Aisle obstruction detected by traffic control",
      operatorId: "traffic-supervisor",
      excludedResourceIds: [`edge:${blockedEdge}`],
    });

    assert.notEqual(result.route.routeId, originalRouteId);
    assert.equal(result.route.segments.some((segment) => segment.edgeId === blockedEdge), false);
    assert.equal(result.revision.revision, 2);
    assert.equal(result.revision.supersedesRouteId, originalRouteId);
    const revisions = await system.core.listMissionRouteRevisions(mission.missionId);
    assert.deepEqual(revisions.map((revision) => [revision.revision, revision.status]), [[1, "RELEASED"], [2, "ACTIVE"]]);
    const active = await system.traffic.listActiveReservations("plant-a@1", system.clock.now());
    assert.equal(active.some((reservation) => reservation.routeId === originalRouteId), false);
    assert.ok(active.some((reservation) => reservation.routeId === result.route.routeId));

    const events = await system.core.getMissionEvents(mission.missionId);
    const replanned = events.filter((event) => event.type === "ROUTE_RESERVED").at(-1)!;
    assert.equal(replanned.data.revision, 2);
    assert.equal(replanned.data.previousRouteId, originalRouteId);
  } finally {
    await system.core.stop();
  }
});

test("a new restriction automatically replans a pre-execution route when a bypass exists", async () => {
  const system = createTestFleetSystem({
    robots: [robotFixture({ robotId: "BR-REPLAN-02", x: 10, y: 5, capabilities: ["pallet_transport"] })],
  });
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture({ externalReference: "REPLAN-002" }));
    const dispatch = await system.core.dispatchMission(mission.missionId);
    const candidate = dispatch.route!.segments.find((segment) => ["E-CENTER-NORTH", "E-NORTH-02"].includes(segment.edgeId));
    assert.ok(candidate);
    await system.core.createTrafficRestriction({
      mapId: "plant-a@1",
      resourceId: `edge:${candidate.edgeId}`,
      reason: "Automated obstruction report",
      operatorId: "traffic-supervisor",
    });
    const current = await system.core.getMissionRoute(mission.missionId);
    assert.notEqual(current?.routeId, dispatch.route?.routeId);
    assert.equal(current?.segments.some((segment) => segment.edgeId === candidate.edgeId), false);
    assert.equal((await system.core.listMissionRouteRevisions(mission.missionId)).length, 2);
  } finally {
    await system.core.stop();
  }
});
