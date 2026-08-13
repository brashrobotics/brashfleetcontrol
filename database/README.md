# Database Assets

**Path:** database/

## Purpose

Owns version-controlled PostgreSQL schema lifecycle and reproducible non-production data.

## Responsibilities

Keep migrations ordered, seeds safe, and test fixtures deterministic.

`init/` bootstraps local-only databases on a fresh Compose volume;
`migrations/` remains the authoritative product schema history.

## Boundaries

Application SQL implementations belong in packages/persistence; production data and secrets never belong here.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
