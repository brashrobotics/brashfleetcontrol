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
