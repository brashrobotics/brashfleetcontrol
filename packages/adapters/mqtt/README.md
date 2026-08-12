# MQTT Robot Adapter

**Path:** packages/adapters/mqtt/

## Purpose

Provides shared infrastructure for custom MQTT robot protocols that are not VDA 5050.

## Responsibilities

Handle broker lifecycle, topic mapping, QoS, retained messages, sessions, message ordering, deduplication, and reconnect behavior.

## Boundaries

Broker delivery is not mission acceptance; explicit command receipts and robot state are still required.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
