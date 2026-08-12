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
