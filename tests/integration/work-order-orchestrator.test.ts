import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, robotFixture } from "@brash/test-kit";

const workOrder = {
  name: "Move inbound pallet",
  externalReference: "ERP-WORK-1001",
  priority: 80,
  requiredCapabilities: ["pallet_transport"],
  payloadKg: 300,
  pickup: { stationId: "WAREHOUSE-A", mapId: "plant-a@1", x: 10, y: 5, zoneId: "warehouse" },
  dropoff: { stationId: "ASSEMBLY-02", mapId: "plant-a@1", x: 70, y: 25, zoneId: "production" },
};

test("orchestrator selects the best robot and binds its preference into the workflow mission", async () => {
  const system = createTestFleetSystem({ robots: [
    robotFixture({ robotId: "BR-CLOSE", x: 11, y: 5, batteryPercent: 75 }),
    robotFixture({ robotId: "BR-FAR", x: 70, y: 70, batteryPercent: 95 }),
  ] });
  await system.core.start();
  try {
    const allocated = await system.core.createWorkOrder(workOrder);
    assert.equal(allocated.status, "ALLOCATED");
    assert.equal(allocated.selectedRobotId, "BR-CLOSE");
    assert.equal(allocated.candidates[0].robotId, "BR-CLOSE");
    assert.ok(allocated.candidates.every((candidate) => candidate.reasons.length > 0));
    const duplicate = await system.core.createWorkOrder(workOrder);
    assert.equal(duplicate.workOrderId, allocated.workOrderId);
    assert.equal((await system.core.listWorkflows()).length, 1);

    assert.equal(await system.core.processWorkflowQueue(), 1);
    const mission = (await system.core.getSnapshot()).missions[0];
    assert.equal(mission.preferredRobotId, "BR-CLOSE");
    assert.equal(mission.assignedRobotId, "BR-CLOSE");
    assert.equal((await system.core.getWorkOrder(allocated.workOrderId)).status, "RUNNING");

    system.clock.advance(1_000);
    await system.adapter.startMission(mission.commandId!);
    await system.adapter.completeMission(mission.commandId!);
    await system.core.processWorkflowQueue();
    assert.equal((await system.core.getWorkOrder(allocated.workOrderId)).status, "SUCCEEDED");
  } finally {
    await system.core.stop();
  }
});

test("orchestrator substitutes a newly unavailable robot and records the actual selection", async () => {
  const system = createTestFleetSystem({ robots: [
    robotFixture({ robotId: "BR-PREFERRED", x: 11, y: 5, batteryPercent: 80 }),
    robotFixture({ robotId: "BR-SUBSTITUTE", x: 30, y: 5, batteryPercent: 90 }),
  ] });
  await system.core.start();
  try {
    const allocated = await system.core.createWorkOrder({ ...workOrder, externalReference: "ERP-WORK-SUBSTITUTE" });
    assert.equal(allocated.selectedRobotId, "BR-PREFERRED");

    await system.adapter.publishRobotState("BR-PREFERRED", { availability: "MANUAL" });
    assert.equal(await system.core.processWorkflowQueue(), 1);

    const mission = (await system.core.getSnapshot()).missions[0];
    assert.equal(mission.assignedRobotId, "BR-SUBSTITUTE");
    assert.equal((await system.core.getWorkOrder(allocated.workOrderId)).selectedRobotId, "BR-SUBSTITUTE");
  } finally {
    await system.core.stop();
  }
});

test("pending work order retries allocation when an eligible robot becomes available", async () => {
  const system = createTestFleetSystem({
    robots: [robotFixture({ robotId: "BR-BUSY", availability: "MANUAL", x: 10, y: 5 })],
    coreOptions: { workOrderRetryBaseMs: 1_000 },
  });
  await system.core.start();
  try {
    const pending = await system.core.createWorkOrder({ ...workOrder, externalReference: "ERP-WORK-RETRY" });
    assert.equal(pending.status, "PENDING");
    assert.equal(pending.selectedRobotId, null);
    assert.match(pending.candidates[0].reasons.join(" "), /MANUAL/);

    await system.adapter.publishRobotState("BR-BUSY", { availability: "AVAILABLE" });
    system.clock.advance(1_000);
    assert.equal(await system.core.processWorkOrderQueue(), 1);
    const allocated = await system.core.getWorkOrder(pending.workOrderId);
    assert.equal(allocated.status, "ALLOCATED");
    assert.equal(allocated.selectedRobotId, "BR-BUSY");
    assert.equal(allocated.allocationAttemptCount, 2);
  } finally {
    await system.core.stop();
  }
});

test("orchestrator compiles service follow-ups into a dependency-ordered workflow", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    await system.core.createInfrastructureResource({
      resourceId: "WORKCELL-QA-01",
      mapId: "plant-a@1",
      displayName: "QA workcell",
      type: "WORKCELL",
      reservationPolicy: "SERVICE_EXCLUSIVE",
      nodeId: "N-QUALITY",
      operatorId: "test-engineer",
    });
    const created = await system.core.createWorkOrder({
      ...workOrder,
      externalReference: "ERP-WORK-INSPECT",
      followUpActions: [{ actionId: "quality", name: "Inspect pallet", type: "INSPECT", resourceId: "WORKCELL-QA-01", durationSeconds: 30 }],
    });
    const workflow = await system.core.getWorkflow(created.workflowId!);
    const inspect = workflow.steps.find((step) => step.stepId === "follow-quality")!;
    assert.equal(inspect.type, "INSPECT");
    assert.deepEqual(inspect.dependsOn, ["transport"]);
    assert.equal(inspect.resourceId, "WORKCELL-QA-01");
    assert.equal(inspect.mission?.preferredRobotId, created.selectedRobotId);
  } finally {
    await system.core.stop();
  }
});
