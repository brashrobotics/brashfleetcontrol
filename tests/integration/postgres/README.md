# PostgreSQL Integration Tests

**Path:** `tests/integration/postgres/`

## Purpose

Validates behavior that cannot be proven with in-memory repositories, including
real migrations, row locking, and concurrent Fleet Core instances.

## Run

Set `TEST_DATABASE_URL` to an isolated disposable database, then run
`npm run test:postgres`. The tests use unique entity IDs but the database must
never point at production.
