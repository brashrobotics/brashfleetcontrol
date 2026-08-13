import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "@brash/domain";
import { createTestFleetSystem } from "@brash/test-kit";

const profileRequest = {
  vendor: "BRASH", model: "SIM-AMR", version: 1, displayName: "SIM-AMR pallet fork profile",
  actions: ["pallet_transport"], maxPayloadKg: 700, allowedZones: ["warehouse", "production"],
  dimensionsMeters: { length: 1.4, width: 0.82, height: 1.2, turningRadius: 0.9 },
  supportedFloorTypes: ["epoxy"], attachments: ["pallet_fork"], supportsCancellation: true,
  adapterProtocolVersion: "1.0", operatorId: "capability-engineer",
};

test("published capability profiles reprofile robots and enforce rich work-order constraints", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const draft = await system.core.createCapabilityProfile(profileRequest);
    assert.equal(draft.status, "DRAFT");
    const published = await system.core.publishCapabilityProfile(draft.profileId, "capability-approver");
    assert.equal(published.status, "PUBLISHED");
    const robot = await system.core.assignRobotCapabilityProfile("BR-01", draft.profileId, "capability-approver");
    assert.equal(robot.capabilities.profileId, draft.profileId);
    assert.deepEqual(robot.capabilities.attachments, ["pallet_fork"]);
    assert.equal(robot.capabilities.dimensionsMeters?.width, 0.82);
    const workOrder = await system.core.createWorkOrder({
      name: "Move pallet through narrow epoxy aisle", externalReference: "CAPABILITY-WORK-1", priority: 80,
      requiredCapabilities: ["pallet_transport"], payloadKg: 600,
      pickup: { stationId: "WAREHOUSE-A", mapId: "plant-a@1", x: 10, y: 5, zoneId: "warehouse" },
      dropoff: { stationId: "ASSEMBLY-02", mapId: "plant-a@1", x: 70, y: 25, zoneId: "production" },
      robotConstraints: { requiredAttachments: ["pallet_fork"], requiredFloorType: "epoxy", maxRobotWidthMeters: 0.9, requiresCancellationSupport: true },
    });
    assert.equal(workOrder.selectedRobotId, "BR-01");
    assert.match(workOrder.candidates.find((candidate) => candidate.robotId === "BR-02")?.reasons.join(" ") ?? "", /attachment|Payload/i);
    await assert.rejects(system.core.retireCapabilityProfile(draft.profileId, "capability-approver"), (error) => error instanceof DomainError && error.code === "CAPABILITY_PROFILE_IN_USE");
  } finally { await system.core.stop(); }
});

test("capability profile vendor and model must match the target robot", async () => {
  const system = createTestFleetSystem();
  await system.core.start();
  try {
    const draft = await system.core.createCapabilityProfile({ ...profileRequest, vendor: "OTHER", version: 2 });
    await system.core.publishCapabilityProfile(draft.profileId, "approver");
    await assert.rejects(system.core.assignRobotCapabilityProfile("BR-01", draft.profileId, "approver"), (error) => error instanceof DomainError && error.code === "CAPABILITY_PROFILE_MODEL_MISMATCH");
  } finally { await system.core.stop(); }
});
