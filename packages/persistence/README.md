# Persistence Package

**Path:** packages/persistence/

## Purpose

Implements application persistence ports using PostgreSQL.

## Responsibilities

Own repository implementations, row/domain mapping, transaction handling, locking, and the transactional outbox.

## Boundaries

Domain and application packages must not depend on this concrete package.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
