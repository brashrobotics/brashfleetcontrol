import assert from "node:assert/strict";
import test from "node:test";
import { MapTopology } from "@brash/domain";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("map revisions move through draft, published, and retired without mutating history", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const current = await system.core.getMapTopology("plant-a@1");
    const draft = await system.core.createMapVersion({
      familyId: "plant-a",
      displayName: "BRASH Demo Plant · revision 2",
      revision: 2,
      nodes: current.nodes,
      edges: current.edges,
      operatorId: "map-engineer",
    });
    assert.equal(draft.mapId, "plant-a@2");
    assert.equal(draft.status, "DRAFT");
    await assert.rejects(() => system.core.createMission(transportMissionFixture({
      externalReference: "DRAFT-MAP-MISSION",
      pickup: { ...transportMissionFixture().pickup, mapId: "plant-a@2" },
      dropoff: { ...transportMissionFixture().dropoff, mapId: "plant-a@2" },
    })), /not_published|is draft/i);

    const published = await system.core.publishMapVersion("plant-a@2", "map-approver");
    assert.equal(published.status, "PUBLISHED");
    assert.deepEqual((await system.core.listMapVersions("plant-a")).map((version) => version.status), ["PUBLISHED", "PUBLISHED"]);

    const retired = await system.core.retireMapVersion("plant-a@2", "map-approver");
    assert.equal(retired.status, "RETIRED");
    await assert.rejects(() => system.maps.save(MapTopology.create({
      mapId: "plant-a@1",
      displayName: "Silently changed published map",
      revision: 1,
      nodes: current.nodes,
      edges: current.edges,
    })), /immutable/);
  } finally {
    await system.core.stop();
  }
});

test("transit infrastructure is reserved, dynamically bypassed on outage, and excluded from new routes", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const door = await system.core.createInfrastructureResource({
      resourceId: "DOOR-CENTER-NORTH",
      mapId: "plant-a@1",
      displayName: "North fire door",
      type: "DOOR",
      reservationPolicy: "TRANSIT_EXCLUSIVE",
      edgeId: "E-CENTER-NORTH",
      operatorId: "facility-engineer",
    });
    assert.equal(door.status, "AVAILABLE");

    const mission = await system.core.createMission(transportMissionFixture({ externalReference: "DOOR-ROUTE-1" }));
    const dispatched = await system.core.dispatchMission(mission.missionId);
    assert.ok(dispatched.route);
    assert.ok((await system.core.getTrafficSchedule("plant-a@1")).reservations
      .some((reservation) => reservation.missionId === mission.missionId && reservation.resourceId === "infrastructure:DOOR-CENTER-NORTH"));

    await system.core.updateInfrastructureResourceStatus(
      "DOOR-CENTER-NORTH", "MAINTENANCE", "Fire door inspection", "facility-engineer",
    );
    const replacement = await system.core.getMissionRoute(mission.missionId);
    assert.notEqual(replacement?.routeId, dispatched.route?.routeId);
    assert.equal(replacement?.segments.some((segment) => segment.edgeId === "E-CENTER-NORTH"), false);
    assert.equal((await system.core.listMissionRouteRevisions(mission.missionId)).length, 2);
    assert.equal((await system.core.getAlarms()).alarms.some((alarm) => alarm.code === "INFRASTRUCTURE_RESOURCE_UNAVAILABLE"), false);
    await system.core.cancelMission(mission.missionId);

    const second = await system.core.createMission(transportMissionFixture({ externalReference: "DOOR-ROUTE-2" }));
    const rerouted = await system.core.dispatchMission(second.missionId);
    assert.equal(rerouted.route?.segments.some((segment) => segment.edgeId === "E-CENTER-NORTH"), false);

    await system.core.updateInfrastructureResourceStatus(
      "DOOR-CENTER-NORTH", "AVAILABLE", "Inspection completed", "facility-engineer",
    );
    assert.equal((await system.core.getAlarms()).alarms.some((alarm) => alarm.code === "INFRASTRUCTURE_RESOURCE_UNAVAILABLE"), false);
  } finally {
    await system.core.stop();
  }
});
