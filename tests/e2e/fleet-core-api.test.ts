import assert from "node:assert/strict";
import test from "node:test";
import { FleetApi } from "../../apps/fleet-server/src/api/fleet-api.js";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("API creates, assigns, dispatches, executes, and completes a transport mission", async () => {
  const { core, adapter, clock } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);

  const createResponse = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(transportMissionFixture()),
  }));
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as {
    mission: { missionId: string; state: string; assignedRobotId: string; commandId: string };
    dispatch: { decision: { selectedRobotId: string }; receipt: { status: string } };
  };
  assert.equal(created.mission.state, "DISPATCHED");
  assert.equal(created.mission.assignedRobotId, "BR-01");
  assert.equal(created.dispatch.decision.selectedRobotId, "BR-01");
  assert.equal(created.dispatch.receipt.status, "ACCEPTED");

  const topologyResponse = await api.fetch(new Request(
    "http://fleet.test/api/v1/maps/plant-a%401/topology",
  ));
  assert.equal(topologyResponse.status, 200);
  const topology = await topologyResponse.json() as { topology: { nodes: unknown[]; edges: unknown[] } };
  assert.ok(topology.topology.nodes.length >= 8);
  assert.ok(topology.topology.edges.length >= 8);

  const activeRouteResponse = await api.fetch(new Request(
    `http://fleet.test/api/v1/missions/${created.mission.missionId}/route`,
  ));
  const activeRoute = await activeRouteResponse.json() as { route: { status: string; segments: unknown[] } };
  assert.equal(activeRoute.route.status, "ACTIVE");
  assert.ok(activeRoute.route.segments.length > 0);

  const scheduleResponse = await api.fetch(new Request(
    "http://fleet.test/api/v1/traffic/schedule?mapId=plant-a%401",
  ));
  assert.equal(scheduleResponse.status, 200);
  const schedule = await scheduleResponse.json() as { schedule: { plans: unknown[]; reservations: unknown[] } };
  assert.equal(schedule.schedule.plans.length, 1);
  assert.ok(schedule.schedule.reservations.length > 0);

  const recoveryResponse = await api.fetch(new Request("http://fleet.test/api/v1/recovery/status"));
  assert.equal(recoveryResponse.status, 200);
  const recovery = await recoveryResponse.json() as {
    recovery: { degradedRobots: number; offlineRobots: number; recoveryRequiredMissions: number; safetyHolds: number };
  };
  assert.equal(recovery.recovery.degradedRobots, 0);
  assert.equal(recovery.recovery.offlineRobots, 0);
  assert.equal(recovery.recovery.recoveryRequiredMissions, 0);
  assert.equal(recovery.recovery.safetyHolds, 0);

  clock.advance(1_000);
  await adapter.startMission(created.mission.commandId);
  clock.advance(2_000);
  await adapter.completeMission(created.mission.commandId);

  const missionResponse = await api.fetch(new Request(
    `http://fleet.test/api/v1/missions/${created.mission.missionId}`,
  ));
  assert.equal(missionResponse.status, 200);
  const completed = await missionResponse.json() as { mission: { state: string } };
  assert.equal(completed.mission.state, "COMPLETED");

  const releasedRouteResponse = await api.fetch(new Request(
    `http://fleet.test/api/v1/missions/${created.mission.missionId}/route`,
  ));
  const releasedRoute = await releasedRouteResponse.json() as { route: { status: string } };
  assert.equal(releasedRoute.route.status, "RELEASED");

  const eventsResponse = await api.fetch(new Request(
    `http://fleet.test/api/v1/missions/${created.mission.missionId}/events`,
  ));
  assert.equal(eventsResponse.status, 200);
  const timeline = await eventsResponse.json() as { events: Array<{ type: string }> };
  assert.deepEqual(timeline.events.map((event) => event.type), [
    "MISSION_QUEUED",
    "MISSION_ASSIGNED",
    "ROUTE_RESERVED",
    "COMMAND_DISPATCHED",
    "MISSION_EXECUTING",
    "MISSION_COMPLETED",
    "ROUTE_RELEASED",
  ]);

  const snapshotResponse = await api.fetch(new Request("http://fleet.test/api/v1/fleet/snapshot"));
  const snapshot = await snapshotResponse.json() as {
    robots: Array<{ robotId: string; state: { availability: string } }>;
  };
  assert.equal(snapshot.robots.find((robot) => robot.robotId === "BR-01")?.state.availability, "AVAILABLE");
  await core.stop();
});

test("API rejects an invalid mission before it reaches the domain", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);
  const response = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "TRANSPORT", priority: 200 }),
  }));

  assert.equal(response.status, 400);
  const payload = await response.json() as { error: { code: string; issues: string[] } };
  assert.equal(payload.error.code, "CONTRACT_VALIDATION_FAILED");
  assert.ok(payload.error.issues.length >= 3);
  await core.stop();
});

test("API does not dispatch an external mission reference twice", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);
  const requestBody = JSON.stringify(transportMissionFixture({ externalReference: "WMS-API-IDEMPOTENT-1" }));

  const first = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: requestBody,
  }));
  const firstBody = await first.json() as { mission: { missionId: string } };

  const duplicate = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: requestBody,
  }));
  const duplicateBody = await duplicate.json() as {
    mission: { missionId: string; state: string };
    dispatch: null;
  };

  assert.equal(duplicate.status, 200);
  assert.equal(duplicateBody.mission.missionId, firstBody.mission.missionId);
  assert.equal(duplicateBody.mission.state, "DISPATCHED");
  assert.equal(duplicateBody.dispatch, null);
  assert.equal((await core.getSnapshot()).missions.length, 1);
  await core.stop();
});
