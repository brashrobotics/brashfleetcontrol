# Event Contracts

**Path:** packages/contracts/events/

## Purpose

Defines versioned events published by Fleet components.

## Responsibilities

Maintain events such as RobotStateUpdatedV1, MissionAssignedV1, MissionCompletedV1, AlarmOpenedV1, and schema-evolution rules.

## Boundaries

Events are durable integration contracts, not arbitrary internal log messages.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
