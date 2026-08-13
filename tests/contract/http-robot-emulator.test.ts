import assert from "node:assert/strict";
import test from "node:test";
import { createDevelopmentSystem } from "../../apps/fleet-server/src/bootstrap/create-development-system.js";
import { startRobotEmulatorHttpServer, type RunningRobotEmulator } from "../../apps/robot-simulator/src/server.js";
import { FLEET_SCHEMA_VERSION, type MissionCommand, type RobotAdapterEvent } from "@brash/contracts";
import { HttpRobotAdapter } from "@brash/http-robot-adapter";

test("external HTTP emulator executes idempotent commands and streams movement events", async () => {
  const emulator = await startTestEmulator();
  const backgroundErrors: Error[] = [];
  const adapter = new HttpRobotAdapter({
    baseUrl: emulator.url,
    eventPollIntervalMs: 5,
    requestTimeoutMs: 1_000,
    onBackgroundError: (error) => { backgroundErrors.push(error); },
  });
  const events: RobotAdapterEvent[] = [];
  adapter.subscribe((event) => { events.push(event); });

  try {
    await adapter.connect();
    const robots = await adapter.listRobots();
    assert.deepEqual(robots.map((robot) => robot.robotId), ["EMU-01", "EMU-02", "EMU-03"]);
    const initial = await adapter.getState("EMU-01");
    const command = commandFixture("HTTP-COMMAND-1", "HTTP-MISSION-1", "EMU-01");

    const first = await adapter.executeMission(command);
    const duplicate = await adapter.executeMission(structuredClone(command));
    assert.deepEqual(duplicate, first);
    assert.equal(first.status, "ACCEPTED");
    await assert.rejects(
      () => adapter.executeMission({ ...command, expiresAt: new Date(Date.now() + 120_000).toISOString() }),
      /reused with different content/,
    );

    await waitFor(() => events.some((event) => event.type === "MISSION_STATUS" && event.commandId === command.commandId && event.status === "COMPLETED"));
    const final = await adapter.getState("EMU-01");
    assert.equal(final.availability, "AVAILABLE");
    assert.equal(final.activeMissionId, null);
    assert.ok(Math.abs(final.pose.x - 30) < 0.001);
    assert.ok(Math.abs(final.pose.y - 23) < 0.001);
    assert.ok(final.batteryPercent < initial.batteryPercent);
    assert.ok(events.some((event) => event.type === "ROBOT_STATE" && event.state.availability === "EXECUTING"));
    const terminalEventCount = events.filter((event) => event.type === "MISSION_STATUS" && event.commandId === command.commandId && event.status === "COMPLETED").length;
    await adapter.executeMission(structuredClone(command));
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(
      events.filter((event) => event.type === "MISSION_STATUS" && event.commandId === command.commandId && event.status === "COMPLETED").length,
      terminalEventCount,
      "replaying a completed command must not execute physical work again",
    );
    assert.equal(backgroundErrors.length, 0);
  } finally {
    await adapter.disconnect();
    await emulator.stop();
  }
});

test("emulator fault controls expose robot and network failures", async () => {
  const token = "emulator-test-token";
  const emulator = await startTestEmulator({ bearerToken: token, missionDurationMs: 1_000 });
  const adapter = new HttpRobotAdapter({
    baseUrl: emulator.url,
    bearerToken: token,
    eventPollIntervalMs: 5,
    requestTimeoutMs: 500,
  });
  const events: RobotAdapterEvent[] = [];
  adapter.subscribe((event) => { events.push(event); });
  const control = (path: string, body: unknown) => fetch(`${emulator.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  try {
    assert.equal((await fetch(`${emulator.url}/api/v1/health`)).status, 401);
    await adapter.connect();
    const stateResponse = await control("/control/v1/robots/EMU-02/state", { connection: "OFFLINE" });
    assert.equal(stateResponse.status, 200);
    await waitFor(() => events.some((event) => event.type === "ROBOT_STATE" && event.state.robotId === "EMU-02" && event.state.connection === "OFFLINE"));
    assert.equal((await adapter.getState("EMU-02")).connection, "OFFLINE");

    assert.equal((await control("/control/v1/network", { available: false })).status, 200);
    const healthDuringOutage = await fetch(`${emulator.url}/api/v1/health`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(healthDuringOutage.status, 200);
    assert.equal((await healthDuringOutage.json() as { robotNetworkAvailable: boolean }).robotNetworkAvailable, false);
    await assert.rejects(() => adapter.getState("EMU-01"), /robot network is unavailable/i);
    assert.equal((await control("/control/v1/network", { available: true })).status, 200);
    assert.equal((await adapter.getState("EMU-01")).connection, "ONLINE");
  } finally {
    await adapter.disconnect();
    await emulator.stop();
  }
});

test("Fleet Core completes a mission through the out-of-process emulator boundary", async () => {
  const emulator = await startTestEmulator();
  const backgroundErrors: Error[] = [];
  const adapter = new HttpRobotAdapter({
    baseUrl: emulator.url,
    eventPollIntervalMs: 5,
    requestTimeoutMs: 1_000,
    onBackgroundError: (error) => { backgroundErrors.push(error); },
  });
  const system = createDevelopmentSystem("plant-a", adapter);

  try {
    await system.core.start();
    const mission = await system.core.createMission({
      type: "TRANSPORT",
      externalReference: "HTTP-EMU-E2E-1",
      priority: 80,
      requiredCapabilities: ["pallet_transport"],
      payloadKg: 250,
      preferredRobotId: "EMU-01",
      pickup: { stationId: "WAREHOUSE-A", mapId: "plant-a@1", x: 10, y: 5, zoneId: "warehouse" },
      dropoff: { stationId: "ASSEMBLY-02", mapId: "plant-a@1", x: 72, y: 24, zoneId: "production" },
    });
    const dispatch = await system.core.dispatchMission(mission.missionId, "EMU-01");
    assert.equal(dispatch.receipt?.status, "ACCEPTED");
    assert.equal(dispatch.mission.assignedRobotId, "EMU-01");

    await waitFor(async () => {
      const snapshot = await system.core.getSnapshot();
      return snapshot.missions.find((entry) => entry.missionId === mission.missionId)?.state === "COMPLETED";
    }, 2_000);
    const snapshot = await system.core.getSnapshot();
    const completed = snapshot.missions.find((entry) => entry.missionId === mission.missionId);
    assert.equal(completed?.state, "COMPLETED");
    assert.equal(snapshot.robots.find((robot) => robot.robotId === "EMU-01")?.state.availability, "AVAILABLE");
    assert.deepEqual(backgroundErrors, []);
  } finally {
    await system.core.stop();
    await emulator.stop();
  }
});

function commandFixture(commandId: string, missionId: string, robotId: string): MissionCommand {
  return {
    schemaVersion: FLEET_SCHEMA_VERSION,
    commandId,
    missionId,
    robotId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    mapId: "plant-a@1",
    steps: [
      { type: "MOVE_TO", target: { stationId: "WAREHOUSE-A", mapId: "plant-a@1", x: 10, y: 5 } },
      { type: "LOAD", stationId: "WAREHOUSE-A", payloadKg: 100 },
      { type: "MOVE_TO", target: { stationId: "PRESS-A", mapId: "plant-a@1", x: 30, y: 23 } },
      { type: "UNLOAD", stationId: "PRESS-A" },
    ],
  };
}

function startTestEmulator(overrides: Parameters<typeof startRobotEmulatorHttpServer>[0] = {}): Promise<RunningRobotEmulator> {
  return startRobotEmulatorHttpServer({
    port: 0,
    startDelayMs: 5,
    missionDurationMs: 80,
    motionUpdateIntervalMs: 5,
    heartbeatIntervalMs: 20,
    ...overrides,
  });
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Condition was not met within ${timeoutMs}ms.`);
}
