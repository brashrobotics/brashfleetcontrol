import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, robotFixture, transportMissionFixture } from "@brash/test-kit";

test("priority aging lets an older low-priority mission dispatch first", async () => {
  const { core, clock } = createTestFleetSystem({
    robots: [robotFixture({ robotId: "BR-QUEUE-01" })],
    coreOptions: { dispatchQueueAgingIntervalMs: 1_000 },
  });
  await core.start();

  const older = await core.createMission(transportMissionFixture({
    externalReference: "QUEUE-OLDER",
    priority: 20,
    autoDispatch: false,
  }));
  clock.advance(10_000);
  const newer = await core.createMission(transportMissionFixture({
    externalReference: "QUEUE-NEWER",
    priority: 25,
    autoDispatch: false,
  }));

  const before = await core.getDispatchQueue();
  assert.deepEqual(before.entries.map((entry) => [entry.missionId, entry.effectivePriority]), [
    [older.missionId, 30],
    [newer.missionId, 25],
  ]);

  assert.equal(await core.processMissionQueue(1), 1);
  assert.equal((await core.getMission(older.missionId)).state, "DISPATCHED");
  assert.equal((await core.getMission(newer.missionId)).state, "QUEUED");
  assert.equal((await core.getDispatchQueue()).pendingMissions, 1);
  await core.stop();
});

test("a queued mission backs off and dispatches when a robot becomes available", async () => {
  const { core, adapter, clock } = createTestFleetSystem({
    robots: [robotFixture({ robotId: "BR-QUEUE-02" })],
    coreOptions: { dispatchRetryBaseMs: 1_000, dispatchRetryMaxMs: 8_000 },
  });
  await core.start();

  const active = await core.createMission(transportMissionFixture({ externalReference: "QUEUE-ACTIVE" }));
  const activeDispatch = await core.dispatchMission(active.missionId);
  const waiting = await core.createMission(transportMissionFixture({
    externalReference: "QUEUE-WAITING",
    autoDispatch: false,
  }));

  assert.equal(await core.processMissionQueue(), 1);
  const deferred = await core.getDispatchQueue();
  assert.equal(deferred.pendingMissions, 1);
  assert.equal(deferred.dueMissions, 0);
  assert.equal(deferred.entries[0].attemptCount, 1);
  assert.match(deferred.entries[0].lastError ?? "", /No robot satisfies/);

  await adapter.startMission(activeDispatch.mission.commandId!);
  await adapter.completeMission(activeDispatch.mission.commandId!);
  assert.equal(await core.processMissionQueue(), 0);
  clock.advance(1_000);
  assert.equal(await core.processMissionQueue(), 1);
  assert.equal((await core.getMission(waiting.missionId)).state, "DISPATCHED");
  assert.equal((await core.getDispatchQueue()).pendingMissions, 0);
  await core.stop();
});

test("a mission queue lease prevents duplicate claims", async () => {
  const { core, missionQueue, clock } = createTestFleetSystem({
    robots: [robotFixture({ robotId: "BR-QUEUE-03", availability: "MANUAL" })],
  });
  await core.start();
  const mission = await core.createMission(transportMissionFixture({ autoDispatch: false }));
  const options = {
    workerId: "worker-a",
    claimedAt: clock.now(),
    leaseDurationMs: 30_000,
    agingIntervalMs: 60_000,
  };

  const first = await missionQueue.claimDue(1, options);
  const duplicate = await missionQueue.claimDue(1, { ...options, workerId: "worker-b" });
  assert.equal(first[0].missionId, mission.missionId);
  assert.equal(duplicate.length, 0);
  await core.stop();
});
