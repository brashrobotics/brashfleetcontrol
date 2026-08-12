# Observability Package

**Path:** packages/observability/

## Purpose

Provides consistent logging, metrics, tracing, and health instrumentation.

## Responsibilities

Standardize robotId, missionId, commandId, correlationId, structured errors, latency metrics, sensitive-data filtering, and trace propagation.

## Boundaries

Operational telemetry must never contain plaintext secrets or excessive raw robot/customer data.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
