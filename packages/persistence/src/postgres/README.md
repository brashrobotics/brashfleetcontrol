# PostgreSQL Persistence Implementation

**Path:** `packages/persistence/src/postgres/`

## Purpose

Provides the concrete durable storage implementation used by Fleet Core.

## Files

- `postgres-database.ts`: connection pool and transaction-scoped SQL execution.
- `postgres-transaction-manager.ts`: application transaction port adapter.
- `postgres-repositories.ts`: row/domain mapping and repository SQL.
- `migrations.ts`: ordered, checksummed, advisory-lock-protected migration runner.
- `postgres-persistence.ts`: composition root for the complete persistence layer.

Repository methods that request `forUpdate` must run inside a transaction. Keep
all SQL parameterized and preserve the documented mission-then-robot lock order.
