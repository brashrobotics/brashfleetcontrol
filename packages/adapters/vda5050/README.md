# VDA 5050 Adapter

**Path:** packages/adapters/vda5050/

## Purpose

Integrates fleets or robots that implement the VDA 5050 protocol.

## Responsibilities

Map canonical missions to orders/actions, normalize state/error/connection/factsheet messages, manage MQTT topics and sequencing, and declare supported VDA version.

## Boundaries

VDA message types must not leak into Fleet domain, dispatch, or UI code.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
