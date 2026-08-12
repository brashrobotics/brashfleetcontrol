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

## Implemented adapters

- In-memory repositories and a process-local transaction manager for tests and demos.
- PostgreSQL repositories for robots, missions, assignment decisions, and commands.
- A pooled PostgreSQL transaction manager with async transaction context.
- A checksummed migration runner protected by a PostgreSQL advisory lock.
- A durable command outbox that retries pending adapter delivery after restart.

The application layer asks for row locks through repository read options; SQL
locking remains encapsulated in this package.
