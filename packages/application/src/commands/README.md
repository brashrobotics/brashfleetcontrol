# Application Commands

**Path:** packages/application/src/commands/

## Purpose

Contains use cases that change system state.

## Responsibilities

Implement workflows such as CreateMission, AssignMission, CancelMission, RegisterRobot, ReserveTrafficResource, and AcknowledgeAlarm.

## Boundaries

Each command must define validation, authorization, transaction boundaries, idempotency, emitted events, and failure behavior.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
