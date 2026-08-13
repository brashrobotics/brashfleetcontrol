import assert from "node:assert/strict";
import test from "node:test";
import { MapTopology } from "../map/map-topology.js";
import { TrafficScheduler, type TrafficReservationSnapshot } from "./traffic-scheduler.js";

const topology = MapTopology.create({
  mapId: "traffic-test@1",
  displayName: "Traffic test",
  revision: 1,
  nodes: [
    { nodeId: "A", label: "A", kind: "STATION", stationId: "A", x: 0, y: 0 },
    { nodeId: "X", label: "Crossing", kind: "INTERSECTION", x: 10, y: 0 },
    { nodeId: "B", label: "B", kind: "STATION", stationId: "B", x: 20, y: 0 },
  ],
  edges: [
    { edgeId: "AX", fromNodeId: "A", toNodeId: "X", directed: false, lengthMeters: 10, travelTimeSeconds: 10 },
    { edgeId: "XB", fromNodeId: "X", toNodeId: "B", directed: false, lengthMeters: 10, travelTimeSeconds: 10 },
  ],
});

test("traffic scheduler shifts the whole route until every shared resource is conflict-free", () => {
  const scheduler = new TrafficScheduler({ clearanceMs: 1_000, nodeHoldMs: 1_000 });
  const requestedStartAt = new Date("2026-08-13T08:00:00.000Z");
  const first = scheduler.schedule({
    routeId: "ROUTE-1",
    missionId: "MISSION-1",
    robotId: "ROBOT-1",
    topology,
    origin: { x: 0, y: 0 },
    pickup: { stationId: "A", x: 0, y: 0 },
    dropoff: { stationId: "B", x: 20, y: 0 },
    requestedStartAt,
    plannedAt: requestedStartAt,
    existingReservations: [],
  });
  const second = scheduler.schedule({
    routeId: "ROUTE-2",
    missionId: "MISSION-2",
    robotId: "ROBOT-2",
    topology,
    origin: { x: 0, y: 0 },
    pickup: { stationId: "A", x: 0, y: 0 },
    dropoff: { stationId: "B", x: 20, y: 0 },
    requestedStartAt,
    plannedAt: requestedStartAt,
    existingReservations: first.reservations,
  });

  assert.equal(first.totalWaitSeconds, 0);
  assert.ok(second.totalWaitSeconds > 0);
  assert.equal(second.segments[0].enterAt.toISOString(), second.scheduledStartAt.toISOString());
  assert.equal(
    second.segments[1].enterAt.toISOString(),
    second.segments[0].exitAt.toISOString(),
    "the scheduler delays route entry instead of inserting a blocking mid-route wait",
  );
  assertNoSharedResourceOverlap(first.reservations, second.reservations);
});

function assertNoSharedResourceOverlap(
  first: TrafficReservationSnapshot[],
  second: TrafficReservationSnapshot[],
): void {
  for (const left of first) {
    for (const right of second) {
      if (left.resourceId !== right.resourceId) continue;
      const overlaps = left.startsAt.getTime() < right.endsAt.getTime()
        && right.startsAt.getTime() < left.endsAt.getTime();
      assert.equal(overlaps, false, `${left.resourceId} must not have overlapping reservations`);
    }
  }
}
