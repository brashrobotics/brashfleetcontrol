# Factory Integrations Module

**Path:** apps/fleet-server/src/modules/integrations/

## Purpose

Connects Fleet Control to non-robot factory and enterprise systems.

## Responsibilities

Integrate MES, WMS, ERP, doors, lifts, conveyors, PLC gateways, and webhooks with idempotent external-reference mapping.

## ERP/WMS event delivery

Work-order creation, allocation, substitution, status changes, failures, and
allocation deferrals are written to `integration_event_outbox` in the same
database transaction as the work-order change. `IntegrationOutboxWorker`
claims due rows with expiring leases and sends them to
`FLEET_INTEGRATION_WEBHOOK_URL`.

Every request includes `Idempotency-Key`, `X-Brash-Event-Id`, and
`X-Brash-Event-Type`. If `FLEET_INTEGRATION_WEBHOOK_SECRET` is configured, the
raw JSON body is signed with HMAC-SHA256 in `X-Brash-Signature-256`. The
consumer must persist the idempotency key before applying the event because a
timeout can occur after it accepted the request.

Failures use bounded exponential backoff. After 12 attempts the event enters
`DEAD_LETTER`; an administrator can inspect it through
`GET /api/v1/integrations/events` and explicitly redrive it with
`POST /api/v1/integrations/events/{eventId}/redrive` after fixing the cause.

## Boundaries

Robot-vendor integrations belong in packages/adapters, not here.
Production webhook endpoints must use HTTPS. Signing secrets must never be
stored in source control.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
