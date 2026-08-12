# Application Package

**Path:** packages/application/

## Purpose

Implements Fleet use cases by coordinating domain objects through abstract ports.

## Responsibilities

Expose commands, queries, policies, and transactional workflows without binding them to infrastructure.

## Boundaries

Must not import concrete database, broker, web framework, or robot-vendor implementations.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
