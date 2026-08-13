import assert from "node:assert/strict";
import test from "node:test";
import { FleetLeaderElection } from "@brash/application";
import { InMemoryLeaderLeaseRepository } from "@brash/persistence";
import { ManualClock } from "@brash/test-kit";

test("expired leader is fenced and takeover receives a monotonically newer token", async () => {
  const clock = new ManualClock();
  const leases = new InMemoryLeaderLeaseRepository();
  const first = new FleetLeaderElection(leases, clock, {
    resourceName: "site:plant-a:control-plane",
    ownerId: "instance-a",
    leaseDurationMs: 2_000,
  });
  const second = new FleetLeaderElection(leases, clock, {
    resourceName: "site:plant-a:control-plane",
    ownerId: "instance-b",
    leaseDurationMs: 2_000,
  });

  const firstLeadership = await first.tick();
  assert.equal(firstLeadership.role, "LEADER");
  assert.equal(firstLeadership.fencingToken, 1);
  assert.equal((await second.tick()).role, "FOLLOWER");
  assert.equal(await first.validateFence(), true);

  clock.advance(2_001);
  const takeover = await second.tick();
  assert.equal(takeover.role, "LEADER");
  assert.equal(takeover.fencingToken, 2);
  assert.equal(await first.validateFence(), false);
  assert.equal((await first.tick()).role, "FOLLOWER");

  await first.stop();
  assert.equal(await second.validateFence(), true, "a stale owner must not release its successor's lease");
});

test("renewal retains a token and clean release permits a fenced successor", async () => {
  const clock = new ManualClock();
  const leases = new InMemoryLeaderLeaseRepository();
  const first = new FleetLeaderElection(leases, clock, {
    resourceName: "site:plant-a:control-plane",
    ownerId: "instance-a",
    leaseDurationMs: 2_000,
  });
  const second = new FleetLeaderElection(leases, clock, {
    resourceName: "site:plant-a:control-plane",
    ownerId: "instance-b",
    leaseDurationMs: 2_000,
  });

  assert.equal((await first.tick()).fencingToken, 1);
  clock.advance(500);
  assert.equal((await first.tick()).fencingToken, 1);
  await first.stop();
  assert.equal((await second.tick()).fencingToken, 2);
});
