# Observability Package

**Path:** packages/observability/

## Purpose

Provides consistent logging, metrics, tracing, and health instrumentation.

## Implemented vertical slice

- `StructuredLogger` emits one-line JSON with level, service, event, correlation
  context, and recursive credential redaction.
- `MetricsRegistry` implements counters, gauges, cumulative histograms, stable
  label ordering, and Prometheus text exposition without runtime dependencies.
- The secured HTTP boundary records normalized-route request count, latency, and
  in-flight metrics. IDs never become metric labels.
- `/api/v1/metrics` publishes API and live Fleet gauges to identities with
  `observability:read`.
- `/api/v1/analytics/operations` computes robot utilization, mission completion,
  workflow retries, traffic waits, and alarm aggregates for the operator console.

## Boundaries

Operational telemetry must never contain plaintext secrets or excessive raw robot/customer data.
Raw authorization headers and request bodies are intentionally excluded.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
