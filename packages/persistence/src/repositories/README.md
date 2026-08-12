# PostgreSQL Repositories

**Path:** packages/persistence/src/repositories/

## Purpose

Implements storage and retrieval for canonical Fleet entities and projections.

## Responsibilities

Provide robot, mission, map, reservation, alarm, audit, command, and event repositories with explicit mapping.

## Boundaries

Repositories should not decide mission transitions or robot eligibility.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
