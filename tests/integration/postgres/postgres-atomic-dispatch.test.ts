import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  FleetCore,
  WeightedDispatchPolicy,
  createDefaultPlantTopology,
  type IdGenerator,
} from "@brash/application";
import { TrafficScheduler } from "@brash/domain";
import { loadPersistenceConfig } from "@brash/config";
import { SimulatorAdapter } from "@brash/simulator-adapter";
import { PostgresPersistence } from "@brash/persistence";
import { ManualClock, robotFixture, transportMissionFixture } from "@brash/test-kit";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("concurrent dispatchers cannot reserve the same PostgreSQL robot", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured.",
}, async () => {
  const suffix = randomUUID();
  const robotId = `PG-ROBOT-${suffix}`;
  const capability = `atomic-dispatch-${suffix}`;
  const clock = new ManualClock();
  const firstPersistence = createPersistence(databaseUrl!);
  const secondPersistence = createPersistence(databaseUrl!);

  await firstPersistence.migrate();
  await firstPersistence.maps.save(createDefaultPlantTopology());
  const first = createCore(firstPersistence, `A-${suffix}`, robotId, capability, clock);
  const second = createCore(secondPersistence, `B-${suffix}`, robotId, capability, clock);

  try {
    await first.start();
    await second.start();
    const firstMission = await first.createMission(transportMissionFixture({
      externalReference: `PG-A-${suffix}`,
      requiredCapabilities: [capability],
    }));
    const secondMission = await second.createMission(transportMissionFixture({
      externalReference: `PG-B-${suffix}`,
      requiredCapabilities: [capability],
    }));

    const results = await Promise.all([
      first.dispatchMission(firstMission.missionId),
      second.dispatchMission(secondMission.missionId),
    ]);
    const selected = results.filter((result) => result.decision.selectedRobotId === robotId);
    const unassigned = results.filter((result) => result.decision.selectedRobotId === null);

    assert.equal(selected.length, 1);
    assert.equal(unassigned.length, 1);
    assert.equal(selected[0].mission.state, "DISPATCHED");
    assert.equal(unassigned[0].mission.state, "QUEUED");

    const robot = await firstPersistence.robots.getById(robotId);
    assert.equal(robot?.availability, "RESERVED");
    assert.equal(robot?.activeMissionId, selected[0].mission.missionId);

    const outbox = await firstPersistence.database.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM command_outbox
      WHERE robot_id = $1
    `, [robotId]);
    assert.equal(outbox.rows[0].count, "1");
  } finally {
    await first.stop();
    await second.stop();
    await firstPersistence.close();
    await secondPersistence.close();
  }
});

test("concurrent PostgreSQL schedulers reserve shared lanes without time overlap", {
  skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured.",
}, async () => {
  const suffix = randomUUID();
  const robotIds = [`PG-TRAFFIC-A-${suffix}`, `PG-TRAFFIC-B-${suffix}`];
  const capability = `traffic-schedule-${suffix}`;
  const clock = new ManualClock(new Date().toISOString());
  const firstPersistence = createPersistence(databaseUrl!);
  const secondPersistence = createPersistence(databaseUrl!);
  await firstPersistence.migrate();
  await firstPersistence.maps.save(createDefaultPlantTopology());
  const first = createMultiRobotCore(firstPersistence, `TA-${suffix}`, robotIds, capability, clock);
  const second = createMultiRobotCore(secondPersistence, `TB-${suffix}`, robotIds, capability, clock);

  try {
    await first.start();
    await second.start();
    const firstMission = await first.createMission(transportMissionFixture({
      externalReference: `PG-TRAFFIC-A-${suffix}`,
      requiredCapabilities: [capability],
    }));
    const secondMission = await second.createMission(transportMissionFixture({
      externalReference: `PG-TRAFFIC-B-${suffix}`,
      requiredCapabilities: [capability],
    }));
    const results = await Promise.all([
      first.dispatchMission(firstMission.missionId),
      second.dispatchMission(secondMission.missionId),
    ]);

    assert.equal(new Set(results.map((result) => result.decision.selectedRobotId)).size, 2);
    assert.ok(results.every((result) => result.route?.status === "ACTIVE"));
    const overlap = await firstPersistence.database.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM traffic_reservations AS left_reservation
      JOIN traffic_reservations AS right_reservation
        ON left_reservation.reservation_id < right_reservation.reservation_id
       AND left_reservation.map_id = right_reservation.map_id
       AND left_reservation.resource_id = right_reservation.resource_id
       AND tstzrange(left_reservation.starts_at, left_reservation.ends_at, '[)')
           && tstzrange(right_reservation.starts_at, right_reservation.ends_at, '[)')
      WHERE left_reservation.mission_id = ANY($1::text[])
        AND right_reservation.mission_id = ANY($1::text[])
        AND left_reservation.state = 'ACTIVE'
        AND right_reservation.state = 'ACTIVE'
    `, [[firstMission.missionId, secondMission.missionId]]);
    assert.equal(overlap.rows[0].count, "0");
  } finally {
    await first.stop();
    await second.stop();
    await firstPersistence.close();
    await secondPersistence.close();
  }
});

function createPersistence(connectionString: string): PostgresPersistence {
  const config = loadPersistenceConfig({
    FLEET_PERSISTENCE: "postgres",
    DATABASE_URL: connectionString,
  });
  return new PostgresPersistence(config.database!);
}

function createCore(
  persistence: PostgresPersistence,
  idPrefix: string,
  robotId: string,
  capability: string,
  clock: ManualClock,
): FleetCore {
  return new FleetCore({
    missions: persistence.missions,
    robots: persistence.robots,
    commands: persistence.commands,
    decisions: persistence.decisions,
    events: persistence.events,
    maps: persistence.maps,
    traffic: persistence.traffic,
    transactions: persistence.transactions,
    clock,
    ids: new PrefixedIdGenerator(idPrefix),
    adapter: new SimulatorAdapter([
      robotFixture({ robotId, capabilities: [capability] }),
    ], { now: () => clock.now() }),
    dispatchPolicy: new WeightedDispatchPolicy(),
    trafficScheduler: new TrafficScheduler(),
    instanceId: `postgres-test-${idPrefix}`,
  });
}

function createMultiRobotCore(
  persistence: PostgresPersistence,
  idPrefix: string,
  robotIds: string[],
  capability: string,
  clock: ManualClock,
): FleetCore {
  return new FleetCore({
    missions: persistence.missions,
    robots: persistence.robots,
    commands: persistence.commands,
    decisions: persistence.decisions,
    events: persistence.events,
    maps: persistence.maps,
    traffic: persistence.traffic,
    transactions: persistence.transactions,
    clock,
    ids: new PrefixedIdGenerator(idPrefix),
    adapter: new SimulatorAdapter(robotIds.map((robotId) => robotFixture({
      robotId,
      x: 10,
      y: 5,
      capabilities: [capability],
    })), { now: () => clock.now() }),
    dispatchPolicy: new WeightedDispatchPolicy(),
    trafficScheduler: new TrafficScheduler(),
    instanceId: `postgres-traffic-test-${idPrefix}`,
  });
}

class PrefixedIdGenerator implements IdGenerator {
  private mission = 0;
  private command = 0;
  private route = 0;

  constructor(private readonly prefix: string) {}

  next(kind: "mission" | "command" | "route"): string {
    if (kind === "mission") return `${this.prefix}-MISSION-${++this.mission}`;
    if (kind === "command") return `${this.prefix}-COMMAND-${++this.command}`;
    return `${this.prefix}-ROUTE-${++this.route}`;
  }
}
