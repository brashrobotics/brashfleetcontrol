import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateWorkflowTemplateRequest } from "@brash/contracts";
import { DomainError } from "@brash/domain";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";

test("published workflow template resolves validated parameters into an immutable workflow", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  const mission = transportMissionFixture({ autoDispatch: false });
  const draft = await system.core.createWorkflowTemplate(parseCreateWorkflowTemplateRequest({
    templateKey: "warehouse-transfer",
    version: 1,
    name: "Warehouse transfer",
    description: "Moves a pallet between parameterized topology nodes.",
    operatorId: "catalog-admin",
    parameters: [
      { name: "pickupNode", required: true },
      { name: "dropoffNode", required: true, allowedValues: ["N-DROPOFF", "N-QUALITY"] },
    ],
    steps: [{
      stepId: "move", name: "Move pallet", type: "TRANSPORT", dependsOn: [],
      timeoutSeconds: 300, maxAttempts: 2, retryDelaySeconds: 5,
      mission: {
        ...mission,
        pickup: { ...mission.pickup, stationId: "{{pickupNode}}" },
        dropoff: { ...mission.dropoff, stationId: "{{dropoffNode}}" },
      },
    }],
  }));
  assert.equal(draft.status, "DRAFT");
  await assert.rejects(() => system.core.instantiateWorkflowTemplate(draft.templateId, { parameters: { pickupNode: "N-PICKUP", dropoffNode: "N-DROPOFF" } }), hasCode("WORKFLOW_TEMPLATE_NOT_PUBLISHED"));

  const published = await system.core.publishWorkflowTemplate(draft.templateId, "publisher-1");
  draft.steps[0].name = "mutated outside repository";
  const workflow = await system.core.instantiateWorkflowTemplate(published.templateId, {
    externalReference: "template-run-001",
    parameters: { pickupNode: "N-PICKUP", dropoffNode: "N-QUALITY" },
  });
  assert.equal(workflow.steps[0].name, "Move pallet");
  assert.equal(workflow.steps[0].mission?.pickup.stationId, "N-PICKUP");
  assert.equal(workflow.steps[0].mission?.dropoff.stationId, "N-QUALITY");
  await assert.rejects(() => system.core.instantiateWorkflowTemplate(published.templateId, {
    parameters: { pickupNode: "N-PICKUP", dropoffNode: "NOT-ALLOWED" },
  }), hasCode("WORKFLOW_TEMPLATE_PARAMETER_INVALID"));

  const second = await system.core.createWorkflowTemplate(parseCreateWorkflowTemplateRequest({
    templateKey: "warehouse-transfer", version: 2, name: "Warehouse transfer v2", description: "New revision.",
    operatorId: "catalog-admin", parameters: [],
    steps: [{ stepId: "wait", name: "Settle", type: "WAIT", dependsOn: [], timeoutSeconds: 10, maxAttempts: 1, retryDelaySeconds: 0, durationSeconds: 1 }],
  }));
  await assert.rejects(() => system.core.publishWorkflowTemplate(second.templateId, "publisher-1"), hasCode("WORKFLOW_TEMPLATE_PUBLISHED_VERSION_EXISTS"));
  await system.core.retireWorkflowTemplate(published.templateId, "publisher-1");
  assert.equal((await system.core.publishWorkflowTemplate(second.templateId, "publisher-1")).status, "PUBLISHED");
  await system.core.stop();
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof DomainError && error.code === code;
}
