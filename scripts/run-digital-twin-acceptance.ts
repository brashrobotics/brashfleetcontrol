import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runDigitalTwinAcceptance,
  type DigitalTwinScenarioDefinition,
} from "../tests/digital-twin/acceptance-harness.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioDirectory = resolve(process.env.DIGITAL_TWIN_SCENARIO_DIRECTORY ?? join(repositoryRoot, "tests/digital-twin/scenarios"));
const reportPath = resolve(process.env.DIGITAL_TWIN_REPORT ?? join(repositoryRoot, "artifacts/digital-twin-acceptance.json"));
const entries = (await readdir(scenarioDirectory)).filter((entry) => entry.endsWith(".json")).sort();
if (!entries.length) throw new Error(`No digital-twin scenarios found in ${scenarioDirectory}.`);

const definitions: DigitalTwinScenarioDefinition[] = [];
for (const entry of entries) {
  definitions.push(JSON.parse(await readFile(join(scenarioDirectory, entry), "utf8")) as DigitalTwinScenarioDefinition);
}
const report = await runDigitalTwinAcceptance(definitions, { release: process.env.GIT_COMMIT ?? "local-worktree" });
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  passed: report.passed,
  scenarios: report.summary,
  reportPath,
}));
if (!report.passed) {
  for (const scenario of report.scenarios.filter((entry) => !entry.passed)) {
    console.error(JSON.stringify({ scenarioId: scenario.scenarioId, checks: scenario.checks.filter((check) => !check.passed), errors: scenario.errors }));
  }
  process.exitCode = 1;
}
