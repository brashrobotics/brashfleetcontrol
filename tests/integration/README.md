# Integration Tests

**Path:** tests/integration/

## Purpose

Verifies components against real infrastructure boundaries.

## Responsibilities

Test PostgreSQL repositories, migrations, transactions, MQTT, outbox processing, APIs, and concurrent assignment.

## Boundaries

Use isolated test infrastructure and deterministic fixtures; never target customer or production systems.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
