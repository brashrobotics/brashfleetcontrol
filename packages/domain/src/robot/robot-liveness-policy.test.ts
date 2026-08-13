import assert from "node:assert/strict";
import test from "node:test";
import { Robot } from "./robot.js";
import { RobotLivenessPolicy } from "./robot-liveness-policy.js";

function robot() {
  const observedAt = new Date("2026-08-12T10:00:00.000Z");
  return Robot.register({
    robotId: "R-01",
    displayName: "R-01",
    vendor: "BRASH",
    model: "SIM",
    capabilities: ["transport"],
    maxPayloadKg: 100,
    allowedZones: [],
  }, {
    robotId: "R-01",
    sequence: 1,
    observedAt,
    connection: "ONLINE",
    availability: "AVAILABLE",
    batteryPercent: 80,
    pose: { mapId: "map@1", x: 0, y: 0, yaw: 0 },
    activeMissionId: null,
  });
}

test("liveness progresses from online to degraded and offline", () => {
  const policy = new RobotLivenessPolicy({ degradedAfterMs: 10_000, offlineAfterMs: 30_000 });
  assert.equal(policy.evaluate(robot(), new Date("2026-08-12T10:00:09.999Z")).connection, "ONLINE");
  assert.equal(policy.evaluate(robot(), new Date("2026-08-12T10:00:10.000Z")).connection, "DEGRADED");
  assert.equal(policy.evaluate(robot(), new Date("2026-08-12T10:00:30.000Z")).connection, "OFFLINE");
});

test("an explicit offline report is immediately offline", () => {
  const current = robot();
  current.applyTelemetry({
    ...current.snapshot(),
    sequence: 2,
    connection: "OFFLINE",
    observedAt: new Date("2026-08-12T10:00:01.000Z"),
  });
  assert.equal(new RobotLivenessPolicy().evaluate(current, new Date("2026-08-12T10:00:01.000Z")).connection, "OFFLINE");
});
