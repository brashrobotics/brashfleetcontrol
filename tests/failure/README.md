# Failure and Recovery Tests

**Path:** tests/failure/

## Purpose

Verifies behavior during infrastructure and robot faults.

## Responsibilities

Cover disconnect/reconnect, duplicate and out-of-order messages, process restarts, expired commands, stuck missions, database/broker outages, and reservation recovery.

## Boundaries

Assert safe state reconciliation and prevention of duplicate physical work, not merely service availability.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
