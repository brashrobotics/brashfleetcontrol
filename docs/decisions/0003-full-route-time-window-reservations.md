# ADR 0003: Full-route time-window reservations

## Status

Accepted for the first traffic scheduler vertical slice.

## Context

Fleet Core must coordinate multiple AMRs without depending on vendor navigation
internals. Edge-by-edge acquisition can create hold-and-wait cycles: one robot
occupies a lane while waiting for a resource held by another robot.

## Decision

Before dispatching a mission, Fleet Core computes the complete
origin-to-pickup-to-drop-off path and reserves every shared edge and node with a
half-open time window. Any conflict shifts the complete candidate plan forward;
the scheduler never inserts a wait while the robot owns an earlier resource.

The mission, robot assignment, command outbox entry, route plan, and
reservations are stored in one transaction. PostgreSQL uses a GiST exclusion
constraint to reject overlapping active reservations for the same map resource.

## Consequences

- Hold-and-wait deadlocks are structurally impossible inside this reservation
  model.
- Scheduling and conflict outcomes are deterministic and auditable.
- The policy sacrifices throughput because future resources are reserved before
  a robot reaches them.
- Adapters must honor `scheduledStartAt`; local collision avoidance and
  safety-rated stopping remain onboard responsibilities.
- Rolling-horizon scheduling, priority preemption, and dynamic replanning remain
  future work.
