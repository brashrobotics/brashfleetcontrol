import { setTimeout as delay } from "node:timers/promises";
import { runLoadScenario } from "../tests/load/load-harness.js";

const baseUrl = (process.env.FLEET_BASE_URL ?? "http://127.0.0.1:4273").replace(/\/$/, "");
const token = process.env.FLEET_TOKEN ?? "brash-dev-operator";
const durationSeconds = positiveNumber("SOAK_DURATION_SECONDS", 300);
const requestsPerSecond = positiveNumber("SOAK_REQUESTS_PER_SECOND", 10);
const maximumP99Ms = positiveNumber("SOAK_MAX_P99_MS", 500);
const endpoints = ["/api/v1/fleet/snapshot", "/api/v1/analytics/operations", "/api/v1/workflows", "/api/v1/alarms"];
const reports = [];
const startedAt = Date.now();

while (Date.now() - startedAt < durationSeconds * 1_000) {
  const remainingMs = durationSeconds * 1_000 - (Date.now() - startedAt);
  const batchStartedAt = Date.now();
  reports.push(await runLoadScenario({
    name: "fleet-http-soak",
    totalOperations: requestsPerSecond,
    concurrency: Math.min(10, requestsPerSecond),
    operation: async (index) => {
      const response = await fetch(`${baseUrl}${endpoints[index % endpoints.length]}`, {
        headers: { authorization: `Bearer ${token}`, "x-fleet-site": "plant-a" },
      });
      if (!response.ok) throw new Error(`${endpoints[index % endpoints.length]} returned ${response.status}.`);
      await response.arrayBuffer();
      return response.status;
    },
  }));
  const waitMs = Math.min(remainingMs, Math.max(0, 1_000 - (Date.now() - batchStartedAt)));
  if (waitMs > 0) await delay(waitMs);
}

const failed = reports.reduce((sum, report) => sum + report.failed, 0);
const total = reports.reduce((sum, report) => sum + report.totalOperations, 0);
const p99 = Math.max(...reports.map((report) => report.latencyMs.p99), 0);
const report = { durationSeconds, requestsPerSecond, total, failed, p99Ms: p99, maximumP99Ms };
console.log(JSON.stringify(report));
if (failed > 0 || p99 > maximumP99Ms) process.exitCode = 1;

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return Math.floor(value);
}
