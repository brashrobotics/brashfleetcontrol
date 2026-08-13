import assert from "node:assert/strict";
import test from "node:test";
import { createTestFleetSystem, transportMissionFixture } from "@brash/test-kit";
import { FleetApi } from "../../apps/fleet-server/src/api/fleet-api.js";
import { runLoadScenario } from "./load-harness.js";

test("Fleet API sustains concurrent snapshot reads within the development latency budget", async () => {
  const { core } = createTestFleetSystem();
  const api = new FleetApi(core);
  await core.start();
  try {
    const report = await runLoadScenario({
      name: "fleet-snapshot-read",
      totalOperations: 1_000,
      concurrency: 50,
      operation: async () => {
        const response = await api.fetch(new Request("http://fleet.test/api/v1/fleet/snapshot"));
        if (!response.ok) throw new Error(`Snapshot returned ${response.status}.`);
        await response.json();
        return response.status;
      },
    });
    assert.equal(report.failed, 0, report.errors.join("\n"));
    assert.equal(report.succeeded, 1_000);
    assert.ok(report.latencyMs.p95 < 250, `p95 ${report.latencyMs.p95}ms exceeded the 250ms development budget.`);
  } finally {
    await core.stop();
  }
});

test("concurrent idempotent mission submissions produce one durable mission", async () => {
  const { core } = createTestFleetSystem();
  const api = new FleetApi(core);
  await core.start();
  try {
    const payload = JSON.stringify(transportMissionFixture({ externalReference: "LOAD-IDEMPOTENCY-1", autoDispatch: false }));
    const report = await runLoadScenario({
      name: "idempotent-mission-create",
      totalOperations: 200,
      concurrency: 25,
      operation: async () => {
        const response = await api.fetch(new Request("http://fleet.test/api/v1/missions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        }));
        if (!response.ok) throw new Error(`Mission creation returned ${response.status}.`);
        return (await response.json() as { mission: { missionId: string } }).mission.missionId;
      },
    });
    assert.equal(report.failed, 0, report.errors.join("\n"));
    assert.equal(new Set(report.results).size, 1);
    assert.equal((await core.getSnapshot()).missions.length, 1);
    assert.ok(report.latencyMs.p95 < 250, `p95 ${report.latencyMs.p95}ms exceeded the 250ms development budget.`);
  } finally {
    await core.stop();
  }
});
