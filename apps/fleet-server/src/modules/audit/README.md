# Audit Module

**Path:** apps/fleet-server/src/modules/audit/

## Purpose

Provides an immutable history of security-sensitive and operator-initiated changes.

## Implemented vertical slice

- Every modifying secured API call first persists an `ATTEMPTED` event. The
  mutation is rejected with `503 AUDIT_UNAVAILABLE` if this write fails.
- Completion adds `SUCCEEDED` or `FAILED`; authorization failures add `DENIED`.
- Events include actor, role, action, target, request path, site, timestamp,
  outcome, response status, and correlation ID. Bearer tokens and request bodies
  are never stored.
- PostgreSQL update/delete triggers enforce append-only records.
- `GET /api/v1/audit/events` supports bounded filtering and requires `audit:read`.

## Boundaries

Audit events are not ordinary debug logs and must not be silently edited or deleted.
They should be exported to immutable retention storage before database retention
or privacy policies are introduced.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
