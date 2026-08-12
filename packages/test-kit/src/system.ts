import { FleetCore, WeightedDispatchPolicy } from "@brash/application";
import { SimulatorAdapter } from "@brash/simulator-adapter";
import {
  InMemoryAssignmentDecisionRepository,
  InMemoryCommandRepository,
  InMemoryMissionRepository,
  InMemoryRobotRepository,
  InMemoryTransactionManager,
} from "@brash/persistence";
import { ManualClock, SequentialIdGenerator } from "./fakes.js";
import { robotFixture } from "./fixtures.js";

export function createTestFleetSystem(options: { autoAdvance?: boolean } = {}) {
  const clock = new ManualClock();
  const ids = new SequentialIdGenerator();
  const adapter = new SimulatorAdapter([
    robotFixture({
      robotId: "BR-01",
      displayName: "Atlas",
      capabilities: ["pallet_transport"],
      maxPayloadKg: 500,
      batteryPercent: 70,
      x: 40,
      y: 5,
    }),
    robotFixture({
      robotId: "BR-02",
      displayName: "Nova",
      capabilities: ["box_transport"],
      maxPayloadKg: 100,
      batteryPercent: 90,
      x: 10,
      y: 5,
    }),
  ], {
    now: () => clock.now(),
    autoAdvance: options.autoAdvance ?? false,
  });
  const missions = new InMemoryMissionRepository();
  const robots = new InMemoryRobotRepository();
  const commands = new InMemoryCommandRepository();
  const decisions = new InMemoryAssignmentDecisionRepository();
  const transactions = new InMemoryTransactionManager();
  const core = new FleetCore({
    missions,
    robots,
    commands,
    decisions,
    transactions,
    clock,
    ids,
    adapter,
    dispatchPolicy: new WeightedDispatchPolicy(),
  });

  return { core, adapter, clock, ids, missions, robots, commands, decisions, transactions };
}
