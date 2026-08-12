# Configuration Package

**Path:** packages/config/

## Purpose

Loads and validates runtime configuration shared by applications and adapters.

## Responsibilities

Define environment-variable schemas, defaults, typed site/adapter configuration, feature flags, and startup validation.

## Boundaries

Store schemas and non-secret defaults only; actual secrets come from the deployment environment or secret manager.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.

## Fleet persistence variables

| Variable | Meaning | Default |
|---|---|---|
| `FLEET_PERSISTENCE` | `memory` or `postgres` | `postgres` when `DATABASE_URL` exists, otherwise `memory` |
| `DATABASE_URL` | PostgreSQL connection string | Required for PostgreSQL |
| `DATABASE_SSL` | Enable PostgreSQL TLS | `false` |
| `DATABASE_POOL_MAX` | Maximum pool connections | `10` |
| `DATABASE_IDLE_TIMEOUT_MS` | Idle connection timeout | `30000` |
| `DATABASE_STATEMENT_TIMEOUT_MS` | Server-side statement timeout | `15000` |

Use `.env.example` for local development and a secret manager in deployed
environments.
