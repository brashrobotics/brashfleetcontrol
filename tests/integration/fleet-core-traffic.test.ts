import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestFleetSystem,
  robotFixture,
  transportMissionFixture,
} from "@brash/test-kit";

test("Fleet Core reserves conflict-free routes and releases them on completion", async () => {
  const { core, adapter, traffic } = createTestFleetSystem({
    robots: [
      robotFixture({ robotId: "BR-TRAFFIC-01", x: 10, y: 5, capabilities: ["pallet_transport"] }),
      robotFixture({ robotId: "BR-TRAFFIC-02", x: 10, y: 5, capabilities: ["pallet_transport"] }),
    ],
  });
  await core.start();

  const firstMission = await core.createMission(transportMissionFixture({ externalReference: "TRAFFIC-1" }));
  const firstDispatch = await core.dispatchMission(firstMission.missionId);
  const secondMission = await core.createMission(transportMissionFixture({ externalReference: "TRAFFIC-2" }));
  const secondDispatch = await core.dispatchMission(secondMission.missionId);

  assert.equal(firstDispatch.route?.status, "ACTIVE");
  assert.equal(firstDispatch.route?.totalWaitSeconds, 0);
  assert.ok((secondDispatch.route?.totalWaitSeconds ?? 0) > 0);
  assert.ok(new Date(secondDispatch.route!.scheduledStartAt) > new Date(firstDispatch.route!.scheduledStartAt));

  const active = await traffic.listActiveReservations("plant-a@1", new Date("2026-08-12T10:00:00.000Z"));
  for (const left of active.filter((reservation) => reservation.missionId === firstMission.missionId)) {
    for (const right of active.filter((reservation) => reservation.missionId === secondMission.missionId)) {
      if (left.resourceId !== right.resourceId) continue;
      const overlaps = left.startsAt < right.endsAt && right.startsAt < left.endsAt;
      assert.equal(overlaps, false, `${left.resourceId} must be exclusively reserved`);
    }
  }

  await adapter.startMission(firstDispatch.mission.commandId!);
  await adapter.completeMission(firstDispatch.mission.commandId!);
  assert.equal((await core.getMissionRoute(firstMission.missionId))?.status, "RELEASED");
  assert.equal((await core.getMissionRoute(secondMission.missionId))?.status, "ACTIVE");
  await core.stop();
});
