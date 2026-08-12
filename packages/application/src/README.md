# Application Source

**Path:** packages/application/src/

## Purpose

Organizes write use cases, read use cases, external ports, and replaceable policies.

## Responsibilities

Keep orchestration explicit and make transaction and authorization boundaries visible.

## Boundaries

Domain invariants remain in domain; transport mapping remains in applications or adapters.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
