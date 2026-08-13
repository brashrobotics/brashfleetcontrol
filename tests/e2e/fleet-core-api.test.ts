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

test("API exposes the prioritized automatic dispatch queue", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);
  const createResponse = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(transportMissionFixture({ autoDispatch: false, externalReference: "QUEUE-API" })),
  }));
  const created = await createResponse.json() as { mission: { missionId: string } };

  const response = await api.fetch(new Request("http://fleet.test/api/v1/dispatch/queue"));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    queue: { pendingMissions: number; dueMissions: number; entries: Array<{ missionId: string; effectivePriority: number }> };
  };
  assert.equal(payload.queue.pendingMissions, 1);
  assert.equal(payload.queue.dueMissions, 1);
  assert.equal(payload.queue.entries[0].missionId, created.mission.missionId);
  assert.equal(payload.queue.entries[0].effectivePriority, 70);
  await core.stop();
});

test("API lists and acknowledges operational alarms", async () => {
  const { core, alarms, clock } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);
  const raised = await alarms.raise({
    fingerprint: "system:test-alarm",
    code: "TEST_ALARM",
    severity: "WARNING",
    title: "Test operational alarm",
    message: "Alarm lifecycle API test.",
    sourceType: "SYSTEM",
    sourceId: "fleet-core",
    occurredAt: clock.now(),
  });

  const listResponse = await api.fetch(new Request("http://fleet.test/api/v1/alarms"));
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json() as { summary: { open: number; alarms: Array<{ alarmId: string }> } };
  assert.equal(list.summary.open, 1);
  assert.equal(list.summary.alarms[0].alarmId, raised.alarmId);

  const acknowledgeResponse = await api.fetch(new Request(
    `http://fleet.test/api/v1/alarms/${raised.alarmId}/acknowledge`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorId: "operator-api", note: "Investigating" }),
    },
  ));
  assert.equal(acknowledgeResponse.status, 200);
  const acknowledged = await acknowledgeResponse.json() as { alarm: { status: string; acknowledgedBy: string } };
  assert.equal(acknowledged.alarm.status, "ACKNOWLEDGED");
  assert.equal(acknowledged.alarm.acknowledgedBy, "operator-api");
  await core.stop();
});

test("API creates, lists, and clears an operator traffic restriction", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);
  try {
    const createResponse = await api.fetch(new Request("http://fleet.test/api/v1/traffic/restrictions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mapId: "plant-a@1",
        resourceId: "edge:E-NORTH-02",
        reason: "API maintenance closure",
        operatorId: "operator-api",
      }),
    }));
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { restriction: { restrictionId: string; status: string } };
    assert.equal(created.restriction.status, "ACTIVE");

    const listResponse = await api.fetch(new Request(
      "http://fleet.test/api/v1/traffic/restrictions?mapId=plant-a%401",
    ));
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json() as { restrictions: Array<{ restrictionId: string }> };
    assert.deepEqual(list.restrictions.map((item) => item.restrictionId), [created.restriction.restrictionId]);

    const clearResponse = await api.fetch(new Request(
      `http://fleet.test/api/v1/traffic/restrictions/${created.restriction.restrictionId}/clear`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operatorId: "operator-supervisor" }),
      },
    ));
    assert.equal(clearResponse.status, 200);
    const cleared = await clearResponse.json() as { restriction: { status: string; clearedBy: string } };
    assert.equal(cleared.restriction.status, "CLEARED");
    assert.equal(cleared.restriction.clearedBy, "operator-supervisor");
  } finally {
    await core.stop();
  }
});

test("API publishes map versions and manages factory infrastructure", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);
  try {
    const topology = await core.getMapTopology("plant-a@1");
    const createMapResponse = await api.fetch(new Request("http://fleet.test/api/v1/map-versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familyId: "api-plant",
        displayName: "API Plant revision 1",
        revision: 1,
        nodes: topology.nodes,
        edges: topology.edges,
        operatorId: "map-api-engineer",
      }),
    }));
    assert.equal(createMapResponse.status, 201);
    const createdMap = await createMapResponse.json() as { version: { mapId: string; status: string } };
    assert.equal(createdMap.version.status, "DRAFT");
    const publishResponse = await api.fetch(new Request(
      `http://fleet.test/api/v1/map-versions/${encodeURIComponent(createdMap.version.mapId)}/publish`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operatorId: "map-api-approver" }) },
    ));
    assert.equal(publishResponse.status, 200);

    const createResourceResponse = await api.fetch(new Request("http://fleet.test/api/v1/infrastructure/resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resourceId: "API-DOOR-01",
        mapId: createdMap.version.mapId,
        displayName: "API north door",
        type: "DOOR",
        reservationPolicy: "TRANSIT_EXCLUSIVE",
        edgeId: topology.edges[0].edgeId,
        operatorId: "facility-api-engineer",
      }),
    }));
    assert.equal(createResourceResponse.status, 201);
    const listResourceResponse = await api.fetch(new Request(
      `http://fleet.test/api/v1/infrastructure/resources?mapId=${encodeURIComponent(createdMap.version.mapId)}`,
    ));
    const listed = await listResourceResponse.json() as { resources: Array<{ resourceId: string; status: string }> };
    assert.deepEqual(listed.resources.map((resource) => resource.resourceId), ["API-DOOR-01"]);

    const statusResponse = await api.fetch(new Request(
      "http://fleet.test/api/v1/infrastructure/resources/API-DOOR-01/status",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "MAINTENANCE", reason: "API test", operatorId: "facility-api-engineer" }),
      },
    ));
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json() as { resource: { status: string } };
    assert.equal(status.resource.status, "MAINTENANCE");
  } finally {
    await core.stop();
  }
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

test("API cancels queued missions locally and dispatched missions through the adapter", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);

  const queuedResponse = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(transportMissionFixture({ autoDispatch: false, externalReference: "CANCEL-QUEUED" })),
  }));
  const queued = await queuedResponse.json() as { mission: { missionId: string; state: string } };
  assert.equal(queued.mission.state, "QUEUED");

  const queuedCancellationResponse = await api.fetch(new Request(
    `http://fleet.test/api/v1/missions/${queued.mission.missionId}/cancel`,
    { method: "POST" },
  ));
  assert.equal(queuedCancellationResponse.status, 200);
  const queuedCancellation = await queuedCancellationResponse.json() as {
    cancellation: { mission: { state: string }; receipt: null };
  };
  assert.equal(queuedCancellation.cancellation.mission.state, "CANCELLED");
  assert.equal(queuedCancellation.cancellation.receipt, null);

  const dispatchedResponse = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(transportMissionFixture({ externalReference: "CANCEL-DISPATCHED" })),
  }));
  const dispatched = await dispatchedResponse.json() as { mission: { missionId: string; state: string } };
  assert.equal(dispatched.mission.state, "DISPATCHED");

  const cancellationResponse = await api.fetch(new Request(
    `http://fleet.test/api/v1/missions/${dispatched.mission.missionId}/cancel`,
    { method: "POST" },
  ));
  assert.equal(cancellationResponse.status, 200);
  const cancellation = await cancellationResponse.json() as {
    cancellation: { mission: { state: string }; receipt: { status: string } };
  };
  assert.equal(cancellation.cancellation.mission.state, "CANCELLED");
  assert.equal(cancellation.cancellation.receipt.status, "ACCEPTED");
  await core.stop();
});

test("API validates, exposes, and cancels durable workflows", async () => {
  const { core } = createTestFleetSystem();
  await core.start();
  const api = new FleetApi(core);

  try {
    const invalid = await api.fetch(new Request("http://fleet.test/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Cyclic workflow",
        steps: [
          { stepId: "a", name: "A", type: "WAIT", dependsOn: ["b"], timeoutSeconds: 60, maxAttempts: 1, retryDelaySeconds: 1, durationSeconds: 1 },
          { stepId: "b", name: "B", type: "WAIT", dependsOn: ["a"], timeoutSeconds: 60, maxAttempts: 1, retryDelaySeconds: 1, durationSeconds: 1 },
        ],
      }),
    }));
    assert.equal(invalid.status, 400);

    const created = await api.fetch(new Request("http://fleet.test/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "API quality hold",
        externalReference: "WF-API-QUALITY-HOLD",
        steps: [{
          stepId: "hold",
          name: "Quality stabilization",
          type: "WAIT",
          dependsOn: [],
          timeoutSeconds: 60,
          maxAttempts: 1,
          retryDelaySeconds: 1,
          durationSeconds: 5,
        }],
      }),
    }));
    assert.equal(created.status, 201);
    const body = await created.json() as { workflow: { workflowId: string; status: string } };
    assert.equal(body.workflow.status, "PENDING");

    const fetched = await api.fetch(new Request(`http://fleet.test/api/v1/workflows/${body.workflow.workflowId}`));
    assert.equal(fetched.status, 200);
    const listed = await api.fetch(new Request("http://fleet.test/api/v1/workflows"));
    const listBody = await listed.json() as { workflows: Array<{ workflowId: string }> };
    assert.deepEqual(listBody.workflows.map((workflow) => workflow.workflowId), [body.workflow.workflowId]);

    const cancelled = await api.fetch(new Request(
      `http://fleet.test/api/v1/workflows/${body.workflow.workflowId}/cancel`,
      { method: "POST" },
    ));
    const cancelledBody = await cancelled.json() as { workflow: { status: string; steps: Array<{ status: string }> } };
    assert.equal(cancelledBody.workflow.status, "CANCELLED");
    assert.deepEqual(cancelledBody.workflow.steps.map((step) => step.status), ["CANCELLED"]);
  } finally {
    await core.stop();
  }
});
