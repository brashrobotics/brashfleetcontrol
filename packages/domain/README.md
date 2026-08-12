# Domain Package

**Path:** packages/domain/

## Purpose

Contains the pure Fleet business model and invariants.

## Responsibilities

Expose framework-independent entities, value objects, domain events, state machines, and business errors.

## Boundaries

Must not depend on HTTP, MQTT, ROS, SQL, UI frameworks, vendor SDKs, or application implementations.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
