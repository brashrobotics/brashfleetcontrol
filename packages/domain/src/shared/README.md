# Shared Domain Primitives

**Path:** packages/domain/src/shared/

## Purpose

Contains genuinely cross-domain primitives needed by multiple domain areas.

## Responsibilities

Provide base entity/value-object support, domain events, result/error types, identifiers, and time abstractions.

## Boundaries

Do not turn this folder into a miscellaneous utils directory; a concept belongs here only when multiple domains share its semantics.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
