import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("operational analytics summarizes live fleet, mission, workflow, traffic, and alarm state", async () => {
  const { core, adapter, clock } = createTestFleetSystem();
  await core.start();
  try {
    const mission = await core.createMission(transportMissionFixture({ externalReference: "ANALYTICS-MISSION" }));
    const dispatch = await core.dispatchMission(mission.missionId);
    let analytics = await core.getOperationalAnalytics();
    assert.equal(analytics.missions.active, 1);
    assert.equal(analytics.traffic.activeRoutes, 1);
    assert.equal(analytics.robots.utilized, 1);
    assert.ok(analytics.robots.utilizationPercent > 0);

    clock.advance(1_000);
    await adapter.startMission(dispatch.mission.commandId!);
    clock.advance(1_000);
    await adapter.completeMission(dispatch.mission.commandId!);
    analytics = await core.getOperationalAnalytics();
    assert.equal(analytics.missions.completed, 1);
    assert.equal(analytics.missions.completionRatePercent, 100);
    assert.equal(analytics.traffic.activeRoutes, 0);
  } finally {
    await core.stop();
  }
});
