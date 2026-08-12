# Traffic Domain

**Path:** packages/domain/src/traffic/

## Purpose

Defines routes, shared resources, reservations, and leases.

## Responsibilities

Model TrafficResource, Reservation, Lease, Route, conflict rules, ownership, expiry, and renewal invariants.

## Boundaries

It represents Fleet-level coordination, not local collision avoidance or safety control.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
