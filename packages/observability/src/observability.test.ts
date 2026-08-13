import assert from "node:assert/strict";
import test from "node:test";
import { StructuredLogger } from "./logger.js";
import { MetricsRegistry } from "./metrics.js";

test("metrics registry renders counters, gauges, and cumulative histograms", () => {
  const metrics = new MetricsRegistry();
  metrics.incrementCounter("brash_test_requests_total", "Test requests.", { route: "/api/:id", status: "200" });
  metrics.setGauge("brash_test_workers", "Test workers.", {}, 3);
  metrics.observeHistogram("brash_test_duration_seconds", "Test duration.", { route: "/api/:id" }, 0.02, [0.01, 0.1]);
  const rendered = metrics.renderPrometheus();
  assert.match(rendered, /brash_test_requests_total\{route="\/api\/:id",status="200"\} 1/);
  assert.match(rendered, /brash_test_workers 3/);
  assert.match(rendered, /brash_test_duration_seconds_bucket\{le="0.1",route="\/api\/:id"\} 1/);
  assert.match(rendered, /brash_test_duration_seconds_count\{route="\/api\/:id"\} 1/);
});

test("structured logger redacts credentials and respects its minimum level", () => {
  const lines: string[] = [];
  const logger = new StructuredLogger("fleet-test", (line) => lines.push(line), () => new Date("2026-08-13T00:00:00.000Z"), "INFO");
  logger.debug("ignored", { token: "must-not-leak" });
  logger.info("request", { authorization: "Bearer must-not-leak", nested: { apiKey: "also-secret", safe: "visible" } });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /must-not-leak|also-secret/);
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(parsed.event, "request");
  assert.equal(parsed.authorization, "[REDACTED]");
  assert.deepEqual(parsed.nested, { apiKey: "[REDACTED]", safe: "visible" });
});
