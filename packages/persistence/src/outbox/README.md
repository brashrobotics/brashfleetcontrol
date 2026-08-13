# Transactional Outbox

**Path:** packages/persistence/src/outbox/

## Purpose

Reliably publishes events associated with committed database changes.

## Responsibilities

Store events in the same transaction as domain changes, publish pending events, retry safely, and track stable event IDs.

## Boundaries

Consumers must still be idempotent because at-least-once delivery may produce duplicates.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.

## Current implementation

Mission commands are inserted into `command_outbox` in the same transaction as
the robot reservation and mission assignment. Delivery happens after commit.
Adapter transport failures leave the row pending. A background worker claims
due rows using expiring leases and retries them with exponential backoff; Fleet
Core also runs the same recovery pass during startup. The original `commandId`
is retained across every attempt. Accepted and rejected receipts close the
outbox row.

This is at-least-once delivery. Every robot adapter must return the original
receipt when it receives a duplicate `commandId`.

Enterprise events use the separate `integration_event_outbox`. Work-order
state and its corresponding event are committed atomically. Rows have a stable
event ID and idempotency key, delivery lease, attempt history, downstream HTTP
status, and terminal dead-letter state. Manual redrive resets only delivery
metadata; it never mutates the original payload or idempotency key.
