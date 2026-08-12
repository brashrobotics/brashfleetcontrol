# Database Migrations

**Path:** database/migrations/

## Purpose

Contains ordered, immutable schema changes applied to Fleet databases.

## Responsibilities

Create tables, indexes, constraints, extensions, and safe data migrations with explicit upgrade behavior.

## Boundaries

Never edit an already-deployed migration; add a new migration and test upgrade/rollback strategy instead.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.

## Implemented schema

`001_initial_fleet.sql` creates the first durable Fleet Core schema:

- `robots` stores registration, capabilities, telemetry, and active reservation.
- `missions` stores mission input and lifecycle state.
- `assignment_decisions` stores explainable dispatch results.
- `command_outbox` stores commands, attempts, and adapter receipts.

Migrations are ordered by numeric filename, checksummed, and recorded in
`fleet_schema_migrations`. Never edit an applied migration; add the next
numbered file.

Run migrations with `npm run db:migrate` after setting `DATABASE_URL`.
