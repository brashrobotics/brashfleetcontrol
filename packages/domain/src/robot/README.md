# Robot Domain

**Path:** packages/domain/src/robot/

## Purpose

Defines the vendor-independent representation and rules for Fleet-managed robots.

## Current model

`Robot` owns vendor-neutral registration, capabilities, payload, telemetry,
availability, connection state, last server contact, and connection transition
time. `RobotLivenessPolicy` deterministically maps heartbeat age to `ONLINE`,
`DEGRADED`, or `OFFLINE`.

Recovered robots may resume their known mission. A robot that reports no active
command is quarantined in `ERROR` before the mission can move to another robot,
preventing duplicate execution.

## Boundaries

No transport protocol or vendor-specific field may enter the canonical robot model.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
