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

## Current implementation

`OutboxRetryWorker` polls every second and claims up to 25 due robot commands.
Fleet Core instances use a 30-second PostgreSQL lease and `FOR UPDATE SKIP
LOCKED`, so multiple server processes can run the worker without delivering the
same row concurrently. Transport failures are retried with exponential backoff
from one second up to one minute, preserving the original `commandId`.

The worker is started after Fleet Core startup and stopped before adapter and
database shutdown. Processing errors are reported without stopping later poll
cycles.

`FleetRecoveryWorker` runs every two seconds. It evaluates heartbeat age,
persists connection transitions, renews traffic leases for healthy robots, and
moves unreachable active missions into an idempotent safety hold. PostgreSQL
row and map locks make the operation safe across multiple Fleet Core instances.

`MissionDispatchWorker` evaluates the durable mission queue every second. It
claims priority-aged work with expiring leases, retries unavailable assignments
with bounded exponential backoff, and immediately removes successfully assigned
or cancelled missions from pending work.

`WorkflowWorker` claims dependency-ready steps every 500 ms. Each step lease is
safe across multiple Fleet Core instances. Transport/service steps correlate a
durable mission, wait steps sleep without holding a worker, and service actions
hold an exclusive infrastructure reservation until success, retry, failure, or
cancellation.
