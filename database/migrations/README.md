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

`002_mission_events_and_outbox_leases.sql` adds:

- `mission_events`, an ordered audit trail of mission lifecycle and delivery events.
- Due-time scheduling and expiring worker leases for safe command retries across server instances.

`003_map_topology_and_traffic_scheduler.sql` adds:

- Versioned graph topologies for factory waypoints, stations, intersections, and lanes.
- Durable route plans and time-window reservations for shared edges and nodes.
- A PostgreSQL exclusion constraint that rejects overlapping active reservations even under concurrent schedulers.

`004_robot_liveness_and_recovery.sql` adds:

- Server-received heartbeat and connection-transition timestamps.
- `DEGRADED`, `OFFLINE`, and mission `RECOVERY_REQUIRED` lifecycle support.
- Renewable route leases and a non-releasing `SAFETY_HOLD` traffic state.

`005_mission_cancellation.sql` adds:

- Durable audit-event types for cancellation requests, adapter delivery failures, and robot rejections.

`006_priority_dispatch_queue.sql` adds:

- A durable mission dispatch queue with retry scheduling and expiring worker leases.
- Priority-aging inputs that prevent low-priority missions from waiting forever.
- Backfill of missions that were already queued before the scheduler upgrade.

`007_alarm_lifecycle.sql` adds:

- Deduplicated operational alarms with severity and occurrence counters.
- Operator acknowledgement identity, note, and timestamp.
- Explicit resolution timestamps while retaining alarm history.

`008_traffic_restrictions.sql` adds:

- Operator-managed edge and node closures with responsible identities and reasons.
- One active restriction per map resource while retaining cleared restriction history.

`009_map_versions_and_infrastructure.sql` adds:

- Immutable draft/published/retired metadata around each topology revision.
- A family/revision uniqueness constraint for safe map publication.
- A typed factory infrastructure catalog with topology bindings and operational status.
- Infrastructure resources as first-class traffic reservation targets.

`010_workflow_engine.sql` adds:

- Durable workflow instances and dependency-aware step state.
- Retry, timeout, wait, mission-correlation, and worker-lease fields.
- Exclusive service-resource reservations protected by a PostgreSQL overlap constraint.

`011_identity_and_audit.sql` adds:

- Append-only security and operator audit events with correlation IDs.
- Actor, role, action, target, outcome, site, and request context indexes.
- Database triggers that reject audit event updates and deletes.

`012_work_order_orchestrator.sql` adds:

- Durable high-level work orders and explainable robot allocation candidates.
- Priority/retry/lease fields for multi-instance orchestrator workers.
- Work-order correlation to compiled workflows and preferred mission robots.

Migrations are ordered by numeric filename, checksummed, and recorded in
`fleet_schema_migrations`. Never edit an applied migration; add the next
numbered file.

Run migrations with `npm run db:migrate` after setting `DATABASE_URL`.
