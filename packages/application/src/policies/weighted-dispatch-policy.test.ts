import assert from "node:assert/strict";
import test from "node:test";
import { WeightedDispatchPolicy } from "@brash/application";
import { Mission, Robot } from "@brash/domain";

const observedAt = new Date("2026-08-12T10:00:00.000Z");

function robot(input: {
  robotId: string;
  capabilities: string[];
  maxPayloadKg: number;
  batteryPercent: number;
  x: number;
}) {
  return Robot.register({
    robotId: input.robotId,
    displayName: input.robotId,
    vendor: "BRASH",
    model: "SIM-AMR",
    capabilities: input.capabilities,
    maxPayloadKg: input.maxPayloadKg,
    allowedZones: ["warehouse"],
  }, {
    robotId: input.robotId,
    sequence: 1,
    observedAt,
    connection: "ONLINE",
    availability: "AVAILABLE",
    batteryPercent: input.batteryPercent,
    pose: { mapId: "plant-a@1", x: input.x, y: 5, yaw: 0 },
    activeMissionId: null,
  });
}

function mission() {
  const result = Mission.create({
    missionId: "MISSION-0001",
    priority: 70,
    requiredCapabilities: ["pallet_transport"],
    payloadKg: 300,
    pickup: { stationId: "A", mapId: "plant-a@1", x: 10, y: 5, zoneId: "warehouse" },
    dropoff: { stationId: "B", mapId: "plant-a@1", x: 70, y: 25 },
    createdAt: observedAt,
  });
  result.queue(observedAt);
  return result;
}

test("dispatch selects an eligible robot over a closer incapable robot", () => {
  const decision = new WeightedDispatchPolicy().select(mission(), [
    robot({ robotId: "BR-01", capabilities: ["pallet_transport"], maxPayloadKg: 500, batteryPercent: 70, x: 40 }),
    robot({ robotId: "BR-02", capabilities: ["box_transport"], maxPayloadKg: 100, batteryPercent: 90, x: 10 }),
  ]);

  assert.equal(decision.selectedRobotId, "BR-01");
  assert.equal(decision.candidates.find((item) => item.robotId === "BR-02")?.eligible, false);
  assert.match(
    decision.candidates.find((item) => item.robotId === "BR-02")?.reasons.join(" ") ?? "",
    /Payload capacity|Missing capability/,
  );
});

test("dispatch tie breaking is deterministic", () => {
  const robots = [
    robot({ robotId: "BR-02", capabilities: ["pallet_transport"], maxPayloadKg: 500, batteryPercent: 80, x: 20 }),
    robot({ robotId: "BR-01", capabilities: ["pallet_transport"], maxPayloadKg: 500, batteryPercent: 80, x: 20 }),
  ];
  assert.equal(new WeightedDispatchPolicy().select(mission(), robots).selectedRobotId, "BR-01");
});

