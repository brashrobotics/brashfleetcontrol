# Robot Adapter Interface

**Path:** packages/robot-adapter-sdk/src/adapter/

## Purpose

Defines the lifecycle and command/state contract every robot adapter implements.

## Responsibilities

Specify connect/disconnect, capability discovery, state subscription, mission execution, acknowledgment, pause/resume/cancel, health, timeout, and idempotency semantics.

## Boundaries

Transport-specific clients and vendor payloads belong in concrete adapter packages.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
