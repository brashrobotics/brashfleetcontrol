# Monitoring Configuration

**Path:** deployment/monitoring/

## Purpose

Defines dashboards, scrape configuration, and alert rules for Fleet operations.

## Implemented baseline

- `prometheus.yml` scrapes the authenticated Fleet metrics endpoint using a
  mounted token file.
- `fleet-alerts.yml` detects API error rate, offline robots, stalled mission
  queues, and critical Fleet alarms.
- Each alert links to [the operator runbook](../../docs/operations/OBSERVABILITY_RUNBOOK.md).

## Boundaries

Alerts must be actionable, severity-ranked, deduplicated, and linked to an operations runbook.
The metrics token must have only the `INTEGRATION` role and must be mounted from
a secret store, never committed to this directory.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
