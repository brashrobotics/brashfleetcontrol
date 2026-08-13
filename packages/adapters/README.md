# Robot Adapters

**Path:** packages/adapters/

## Purpose

Contains concrete integrations that translate between robot systems and the canonical Robot Adapter contract.

## Responsibilities

Isolate protocol clients, coordinate transforms, capability mapping, state normalization, command translation, and vendor error mapping per adapter.

Fleet Core can receive one `CompositeRobotAdapter` containing any number of
conformant REST, MQTT, VDA 5050, simulator, or customer-specific adapters.
Robot IDs and adapter IDs must be globally unique within that composite.

## Boundaries

Adapters do not own mission assignment, Fleet traffic policy, UI behavior, or domain state machines.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
