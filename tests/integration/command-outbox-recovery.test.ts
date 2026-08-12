import assert from "node:assert/strict";
import test from "node:test";
import { FleetCore, WeightedDispatchPolicy } from "@brash/application";
import type { MissionCommand } from "@brash/contracts";
import type { RobotAdapter } from "@brash/robot-adapter-sdk";
import { SimulatorAdapter } from "@brash/simulator-adapter";
import {
  InMemoryAssignmentDecisionRepository,
  InMemoryCommandRepository,
  InMemoryMissionRepository,
  InMemoryRobotRepository,
  InMemoryTransactionManager,
} from "@brash/persistence";
import {
  ManualClock,
  SequentialIdGenerator,
  robotFixture,
  transportMissionFixture,
} from "@brash/test-kit";

class FailFirstDeliveryAdapter implements RobotAdapter {
  readonly adapterId = "fail-first-delivery";
  private mustFail = true;

  constructor(private readonly delegate: SimulatorAdapter) {}

  connect = () => this.delegate.connect();
  disconnect = () => this.delegate.disconnect();
  listRobots = () => this.delegate.listRobots();
  getState = (robotId: string) => this.delegate.getState(robotId);
  cancelMission = (robotId: string, commandId: string) => this.delegate.cancelMission(robotId, commandId);
  subscribe: RobotAdapter["subscribe"] = (handler) => this.delegate.subscribe(handler);

  async executeMission(command: MissionCommand) {
    if (this.mustFail) {
      this.mustFail = false;
      throw new Error("Temporary adapter connection failure.");
    }
    return this.delegate.executeMission(command);
  }
}

test("a pending command survives a Fleet Core restart and is delivered with the same command ID", async () => {
  const clock = new ManualClock();
  const adapter = new FailFirstDeliveryAdapter(new SimulatorAdapter([
    robotFixture({ robotId: "BR-RECOVERY-01" }),
  ], { now: () => clock.now() }));
  const dependencies = {
    missions: new InMemoryMissionRepository(),
    robots: new InMemoryRobotRepository(),
    commands: new InMemoryCommandRepository(),
    decisions: new InMemoryAssignmentDecisionRepository(),
    transactions: new InMemoryTransactionManager(),
    clock,
    ids: new SequentialIdGenerator(),
    adapter,
    dispatchPolicy: new WeightedDispatchPolicy(),
  };

  const firstCore = new FleetCore(dependencies);
  await firstCore.start();
  const created = await firstCore.createMission(transportMissionFixture());
  const firstAttempt = await firstCore.dispatchMission(created.missionId);
  assert.equal(firstAttempt.mission.state, "ASSIGNED");
  assert.equal(firstAttempt.receipt, null);
  const [pendingBeforeRestart] = await dependencies.commands.listPending();
  assert.equal(pendingBeforeRestart.attemptCount, 1);
  assert.equal(pendingBeforeRestart.command.commandId, "COMMAND-0001");
  await firstCore.stop();

  const restartedCore = new FleetCore(dependencies);
  await restartedCore.start();
  const recovered = await restartedCore.getMission(created.missionId);
  assert.equal(recovered.state, "DISPATCHED");
  assert.equal(recovered.commandId, "COMMAND-0001");
  assert.equal((await dependencies.commands.listPending()).length, 0);
  await restartedCore.stop();
});

test("startup reconciliation does not overwrite a durable reservation with stale available telemetry", async () => {
  const clock = new ManualClock();
  const shared = {
    missions: new InMemoryMissionRepository(),
    robots: new InMemoryRobotRepository(),
    commands: new InMemoryCommandRepository(),
    decisions: new InMemoryAssignmentDecisionRepository(),
    transactions: new InMemoryTransactionManager(),
    clock,
    ids: new SequentialIdGenerator(),
    dispatchPolicy: new WeightedDispatchPolicy(),
  };
  const definition = robotFixture({ robotId: "BR-RECONCILE-01" });
  const firstCore = new FleetCore({
    ...shared,
    adapter: new SimulatorAdapter([definition], { now: () => clock.now() }),
  });
  await firstCore.start();
  const mission = await firstCore.createMission(transportMissionFixture());
  const dispatch = await firstCore.dispatchMission(mission.missionId);
  assert.equal(dispatch.mission.state, "DISPATCHED");
  await firstCore.stop();

  const restartedCore = new FleetCore({
    ...shared,
    adapter: new SimulatorAdapter([definition], { now: () => clock.now() }),
  });
  await restartedCore.start();
  const robot = (await restartedCore.getSnapshot()).robots.find(
    (candidate) => candidate.robotId === definition.descriptor.robotId,
  );
  assert.equal(robot?.state.availability, "RESERVED");
  assert.equal(robot?.state.activeMissionId, mission.missionId);
  await restartedCore.stop();
});
