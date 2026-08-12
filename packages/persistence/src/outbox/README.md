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
Adapter transport failures leave the row pending; Fleet Core retries pending
rows after restart with the original `commandId`. Accepted and rejected
receipts close the outbox row.

This is at-least-once delivery. Every robot adapter must return the original
receipt when it receives a duplicate `commandId`.
