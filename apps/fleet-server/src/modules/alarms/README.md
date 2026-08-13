# Alarms Module

**Path:** apps/fleet-server/src/modules/alarms/

## Purpose

Maintains actionable operational conditions that operators must see or acknowledge.

## Responsibilities

Create, deduplicate, classify, acknowledge, and close alarms linked to robots, missions, commands, maps, or infrastructure.

## Implemented lifecycle

- Stable fingerprints merge repeated observations and increment an occurrence counter.
- `INFO`, `WARNING`, and `CRITICAL` severity drives operator ordering.
- Operators acknowledge active alarms with identity, timestamp, and an optional note.
- Acknowledged alarms stay visible until Fleet Core observes that the condition is resolved.
- Heartbeat, mission recovery, command delivery, and cancellation failures are wired into the lifecycle.
- PostgreSQL retains resolved alarms for later audit and reliability analysis.

## Boundaries

Alarms describe operational conditions; immutable user actions belong in audit.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
