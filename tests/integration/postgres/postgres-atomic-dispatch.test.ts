import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  FleetCore,
  WeightedDispatchPolicy,
  type IdGenerator,
} from "@brash/application";
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
  const clock = new ManualClock();
  const firstPersistence = createPersistence(databaseUrl!);
  const secondPersistence = createPersistence(databaseUrl!);

  await firstPersistence.migrate();
  const first = createCore(firstPersistence, `A-${suffix}`, robotId, clock);
  const second = createCore(secondPersistence, `B-${suffix}`, robotId, clock);

  try {
    await first.start();
    await second.start();
    const firstMission = await first.createMission(transportMissionFixture({
      externalReference: `PG-A-${suffix}`,
    }));
    const secondMission = await second.createMission(transportMissionFixture({
      externalReference: `PG-B-${suffix}`,
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
  clock: ManualClock,
): FleetCore {
  return new FleetCore({
    missions: persistence.missions,
    robots: persistence.robots,
    commands: persistence.commands,
    decisions: persistence.decisions,
    transactions: persistence.transactions,
    clock,
    ids: new PrefixedIdGenerator(idPrefix),
    adapter: new SimulatorAdapter([
      robotFixture({ robotId }),
    ], { now: () => clock.now() }),
    dispatchPolicy: new WeightedDispatchPolicy(),
  });
}

class PrefixedIdGenerator implements IdGenerator {
  private mission = 0;
  private command = 0;

  constructor(private readonly prefix: string) {}

  next(kind: "mission" | "command"): string {
    if (kind === "mission") return `${this.prefix}-MISSION-${++this.mission}`;
    return `${this.prefix}-COMMAND-${++this.command}`;
  }
}
