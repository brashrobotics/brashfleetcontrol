# Operations Documentation

**Path:** docs/operations/

## Purpose

Provides runbooks for installing, operating, recovering, and upgrading Fleet Control.

Current runbooks:

- [Observability and incident response](./OBSERVABILITY_RUNBOOK.md)
- [Resilience testing](./RESILIENCE_TESTING.md)
- [Site isolation and provisioning](./SITE_ISOLATION.md)

## Responsibilities

Document startup/shutdown, upgrade/rollback, backup/restore, incident response, offline robots, stuck missions, and broker/database outages.

## Boundaries

Every alert requiring human action should link to a tested runbook in this area.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
