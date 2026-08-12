# Robot Domain

**Path:** packages/domain/src/robot/

## Purpose

Defines the vendor-independent representation and rules for Fleet-managed robots.

## Responsibilities

Model Robot, RobotId, RobotState, RobotCapability, footprint, payload, energy, availability, and valid state transitions.

## Boundaries

No transport protocol or vendor-specific field may enter the canonical robot model.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
