# Fleet Background Workers

**Path:** apps/fleet-server/src/workers/

## Purpose

Runs periodic and asynchronous work outside the lifetime of an HTTP request.

## Responsibilities

Detect offline robots, expire commands and leases, dispatch queued missions, publish outbox events, aggregate telemetry, and apply retries.

## Boundaries

Every worker must be safe under multiple instances by using leases, locks, or idempotent processing.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
