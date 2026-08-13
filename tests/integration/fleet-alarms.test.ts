import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, robotFixture, transportMissionFixture } from "@brash/test-kit";

test("robot liveness alarms escalate, acknowledge, deduplicate, and resolve", async () => {
  const system = createTestFleetSystem({ robots: [robotFixture({ robotId: "BR-ALARM-01" })] });
  await system.core.start();
  try {
    const mission = await system.core.createMission(transportMissionFixture());
    const dispatch = await system.core.dispatchMission(mission.missionId);

    system.clock.advance(10_001);
    await system.core.processFleetRecovery();
    let summary = await system.core.getAlarms();
    assert.equal(summary.warning, 1);
    assert.equal(summary.alarms[0].code, "ROBOT_HEARTBEAT_DEGRADED");

    await system.core.processFleetRecovery();
    summary = await system.core.getAlarms();
    assert.equal(summary.alarms[0].occurrenceCount, 1);

    system.clock.advance(20_000);
    await system.core.processFleetRecovery();
    summary = await system.core.getAlarms();
    assert.equal(summary.warning, 0);
    assert.equal(summary.critical, 2);
    assert.deepEqual(new Set(summary.alarms.map((alarm) => alarm.code)), new Set([
      "ROBOT_OFFLINE",
      "MISSION_RECOVERY_REQUIRED",
    ]));

    const missionAlarm = summary.alarms.find((alarm) => alarm.code === "MISSION_RECOVERY_REQUIRED")!;
    const acknowledged = await system.core.acknowledgeAlarm(
      missionAlarm.alarmId,
      "operator-aras",
      "Robot area is being inspected.",
    );
    assert.equal(acknowledged.status, "ACKNOWLEDGED");
    assert.equal(acknowledged.acknowledgedBy, "operator-aras");
    assert.equal((await system.core.getAlarms()).acknowledged, 1);

    await system.adapter.publishRobotState(dispatch.decision.selectedRobotId!, {
      connection: "ONLINE",
      availability: "RESERVED",
      activeMissionId: mission.missionId,
    });
    summary = await system.core.getAlarms();
    assert.equal(summary.alarms.length, 0);
  } finally {
    await system.core.stop();
  }
});

test("the alarm repository deduplicates repeated operational conditions", async () => {
  const { alarms, clock } = createTestFleetSystem();
  const input = {
    fingerprint: "system:broker-unreachable",
    code: "BROKER_UNREACHABLE",
    severity: "CRITICAL" as const,
    title: "Robot broker is unreachable",
    message: "Fleet Core cannot connect to the robot command broker.",
    sourceType: "SYSTEM" as const,
    sourceId: "robot-broker",
    occurredAt: clock.now(),
  };
  const first = await alarms.raise(input);
  clock.advance(1_000);
  const repeated = await alarms.raise({ ...input, occurredAt: clock.now() });

  assert.equal(repeated.alarmId, first.alarmId);
  assert.equal(repeated.occurrenceCount, 2);
  assert.equal((await alarms.listActive()).length, 1);
});
