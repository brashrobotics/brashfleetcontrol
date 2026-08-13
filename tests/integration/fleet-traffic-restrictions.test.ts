import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("new routes avoid closed edges and active-route closures raise an alarm", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const closed = await system.core.createTrafficRestriction({
      mapId: "plant-a@1", resourceId: "edge:E-NORTH-02",
      reason: "Maintenance work", operatorId: "operator-traffic",
    });
    const mission = await system.core.createMission(transportMissionFixture({ externalReference: "RESTRICTED-ROUTE" }));
    const dispatch = await system.core.dispatchMission(mission.missionId);
    assert.equal(dispatch.route?.segments.some((segment) => segment.edgeId === "E-NORTH-02"), false);

    const activeEdge = dispatch.route!.segments[0].edgeId;
    const impacted = await system.core.createTrafficRestriction({
      mapId: "plant-a@1", resourceId: `edge:${activeEdge}`,
      reason: "Unexpected aisle obstruction", operatorId: "operator-traffic",
    });
    const alarms = await system.core.getAlarms();
    assert.ok(alarms.alarms.some((alarm) => alarm.code === "ACTIVE_ROUTE_RESTRICTED"));

    await system.core.clearTrafficRestriction(impacted.restrictionId, "operator-supervisor");
    assert.equal((await system.core.getAlarms()).alarms.some((alarm) => alarm.code === "ACTIVE_ROUTE_RESTRICTED"), false);
    await system.core.clearTrafficRestriction(closed.restrictionId, "operator-supervisor");
    assert.equal((await system.core.listTrafficRestrictions("plant-a@1")).length, 0);
  } finally {
    await system.core.stop();
  }
});
