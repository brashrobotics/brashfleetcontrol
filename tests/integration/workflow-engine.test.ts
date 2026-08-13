import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("workflow executes a transport and then a dependency-gated wait", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const workflow = await system.core.createWorkflow({
      name: "Move then stabilize",
      externalReference: "WORKFLOW-DAG-1",
      steps: [
        {
          stepId: "move", name: "Move material", type: "TRANSPORT", dependsOn: [],
          timeoutSeconds: 120, maxAttempts: 2, retryDelaySeconds: 1,
          mission: transportMissionFixture({ externalReference: undefined, autoDispatch: false }),
        },
        {
          stepId: "stabilize", name: "Stabilization wait", type: "WAIT", dependsOn: ["move"],
          timeoutSeconds: 30, maxAttempts: 1, retryDelaySeconds: 0, durationSeconds: 5,
        },
      ],
    });
    assert.equal(workflow.status, "PENDING");
    assert.equal(await system.core.processWorkflowQueue(), 1);
    let current = await system.core.getWorkflow(workflow.workflowId);
    const move = current.steps.find((step) => step.stepId === "move")!;
    assert.equal(move.status, "RUNNING");
    const mission = await system.core.getMission(move.missionId!);
    await system.adapter.startMission(mission.commandId!);
    system.clock.advance(1_000);
    await system.adapter.completeMission(mission.commandId!);

    system.clock.advance(1_000);
    await system.core.processWorkflowQueue();
    current = await system.core.getWorkflow(workflow.workflowId);
    assert.equal(current.steps.find((step) => step.stepId === "move")?.status, "SUCCEEDED");
    assert.equal(current.steps.find((step) => step.stepId === "stabilize")?.status, "PENDING");

    await system.core.processWorkflowQueue();
    system.clock.advance(5_000);
    await system.core.processWorkflowQueue();
    current = await system.core.getWorkflow(workflow.workflowId);
    assert.equal(current.status, "SUCCEEDED");
    assert.deepEqual(current.steps.map((step) => step.status), ["SUCCEEDED", "SUCCEEDED"]);
  } finally {
    await system.core.stop();
  }
});

test("service workflows serialize access to one charger and retry the loser", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    await system.core.createInfrastructureResource({
      resourceId: "CHARGER-WORKFLOW-01", mapId: "plant-a@1", displayName: "Workflow charger",
      type: "CHARGER", reservationPolicy: "SERVICE_EXCLUSIVE", nodeId: "N-CHARGER-C-02",
      operatorId: "workflow-test",
    });
    const definition = (reference: string) => ({
      name: `Charge ${reference}`,
      externalReference: reference,
      steps: [{
        stepId: "charge", name: "Charge robot", type: "CHARGE" as const, dependsOn: [],
        timeoutSeconds: 180, maxAttempts: 5, retryDelaySeconds: 1, durationSeconds: 2,
        resourceId: "CHARGER-WORKFLOW-01",
        mission: transportMissionFixture({
          externalReference: undefined,
          autoDispatch: false,
          dropoff: { stationId: "CHARGER-C-02", mapId: "plant-a@1", x: 50, y: 84, zoneId: "warehouse" },
        }),
      }],
    });
    const first = await system.core.createWorkflow(definition("CHARGE-WORKFLOW-1"));
    const second = await system.core.createWorkflow(definition("CHARGE-WORKFLOW-2"));
    assert.equal(await system.core.processWorkflowQueue(), 2);
    let workflows = [await system.core.getWorkflow(first.workflowId), await system.core.getWorkflow(second.workflowId)];
    assert.deepEqual(workflows.map((workflow) => workflow.steps[0].status), ["RUNNING", "WAITING_RETRY"]);

    const firstMission = await system.core.getMission(workflows[0].steps[0].missionId!);
    await system.adapter.startMission(firstMission.commandId!);
    system.clock.advance(1_000);
    await system.adapter.completeMission(firstMission.commandId!);
    await system.core.processWorkflowQueue();
    system.clock.advance(2_000);
    await system.core.processWorkflowQueue();

    workflows = [await system.core.getWorkflow(first.workflowId), await system.core.getWorkflow(second.workflowId)];
    assert.equal(workflows[0].status, "SUCCEEDED");
    assert.equal(workflows[1].steps[0].status, "RUNNING");
    assert.ok(workflows[1].steps[0].missionId);
  } finally {
    await system.core.stop();
  }
});

test("workflow retries a timed-out step and fails after the configured attempts", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const workflow = await system.core.createWorkflow({
      name: "Timeout policy",
      steps: [{
        stepId: "slow-wait", name: "Slow wait", type: "WAIT", dependsOn: [],
        timeoutSeconds: 2, maxAttempts: 2, retryDelaySeconds: 3, durationSeconds: 10,
      }],
    });
    await system.core.processWorkflowQueue();
    system.clock.advance(2_000);
    await system.core.processWorkflowQueue();
    assert.equal((await system.core.getWorkflow(workflow.workflowId)).steps[0].status, "WAITING_RETRY");
    system.clock.advance(3_000);
    await system.core.processWorkflowQueue();
    system.clock.advance(2_000);
    await system.core.processWorkflowQueue();
    const failed = await system.core.getWorkflow(workflow.workflowId);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.steps[0].attemptCount, 2);
    assert.match(failed.failureReason ?? "", /timed out/);
  } finally {
    await system.core.stop();
  }
});

