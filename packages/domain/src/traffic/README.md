# Traffic Domain

**Path:** packages/domain/src/traffic/

## Purpose

Defines routes, shared resources, reservations, and leases.

## Current model

`TrafficScheduler` calculates origin-to-pickup-to-drop-off routes and converts
them into ordered route segments plus edge/node reservations. Conflicting
half-open windows cause the complete candidate route to move forward until all
resources are available. The resulting plan records requested and scheduled
start, expected arrival, distance, and accumulated wait.

Whole-route acquisition means a scheduled robot never holds one Fleet resource
while waiting to acquire another; this removes hold-and-wait deadlocks within
the scheduler's graph and reservation model.

## Future model

Add renewable leases, priority/preemption policy, infrastructure resources,
rolling-horizon optimization, offline ownership recovery, and dynamic rerouting.

## Boundaries

It represents Fleet-level coordination, not local collision avoidance or safety control.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
