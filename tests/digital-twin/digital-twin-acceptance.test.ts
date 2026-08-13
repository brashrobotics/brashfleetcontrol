import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runDigitalTwinAcceptance, type DigitalTwinScenarioDefinition } from "./acceptance-harness.js";

test("digital-twin release scenarios satisfy every safety and behavior threshold", async () => {
  const scenarioDirectory = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
  const definitions = await Promise.all((await readdir(scenarioDirectory)).filter((entry) => entry.endsWith(".json")).sort().map(async (entry) =>
    JSON.parse(await readFile(join(scenarioDirectory, entry), "utf8")) as DigitalTwinScenarioDefinition));
  const report = await runDigitalTwinAcceptance(definitions, {
    release: "test-release",
    generatedAt: new Date("2026-08-13T12:00:00.000Z"),
  });
  assert.equal(report.passed, true, JSON.stringify(report.scenarios.filter((scenario) => !scenario.passed), null, 2));
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.failed, 0);
  assert.ok(report.scenarios.every((scenario) => /^[a-f0-9]{64}$/.test(scenario.scenarioHash)));
});
