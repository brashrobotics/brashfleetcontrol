# Application Queries

**Path:** packages/application/src/queries/

## Purpose

Contains read-only use cases and projection contracts.

## Responsibilities

Implement Fleet snapshots, robot lists, mission timelines, traffic occupancy, alarms, and operational summaries.

## Boundaries

Queries must not mutate domain state or hide writes inside repository calls.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
