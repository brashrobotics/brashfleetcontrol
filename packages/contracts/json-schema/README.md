# JSON Schemas

**Path:** packages/contracts/json-schema/

## Purpose

Defines runtime-validatable payloads shared with adapters and external systems.

## Responsibilities

Version RobotState, RobotCapabilities, MissionCommand, CommandReceipt, configuration, and adapter messages.

## Boundaries

Schema changes must be explicit; unknown vendor fields should be normalized or isolated in extensions.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
