# PostgreSQL Integration Tests

**Path:** `tests/integration/postgres/`

## Purpose

Validates behavior that cannot be proven with in-memory repositories, including
real migrations, row locking, and concurrent Fleet Core instances.

## Run

Set `TEST_DATABASE_URL` to an isolated disposable database, then run
`npm run test:postgres`. The tests use unique entity IDs but the database must
never point at production.

The repository's PostgreSQL Compose service creates `brash_fleet_test` on a
fresh volume. Existing development volumes can add it once with:

```bash
docker compose exec postgres createdb -U brash brash_fleet_test
```

Never set `TEST_DATABASE_URL` to the running development database: background
Fleet workers can legitimately claim test rows and invalidate concurrency
assertions.
