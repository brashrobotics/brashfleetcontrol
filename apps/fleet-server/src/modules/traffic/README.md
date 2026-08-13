# Traffic Module

**Path:** apps/fleet-server/src/modules/traffic/

## Purpose

Coordinates planned use of shared factory space and infrastructure resources.

## Implemented vertical slice

- Resolves robot, pickup, and drop-off coordinates to the nearest topology nodes.
- Reserves every traversed edge and node using half-open time windows.
- Shifts an entire route past conflicts instead of allowing mid-route holds.
- Persists route plans and reservations atomically with mission assignment.
- Uses a PostgreSQL exclusion constraint as the final overlap safety barrier.
- Releases reservations when a mission completes, fails, is cancelled, or its
  command is rejected.
- Exposes map schedules and per-mission routes through `/api/v1`.
- Renews route leases while the assigned robot remains healthy.
- Converts active reservations to non-expiring safety holds when heartbeat
  expiry makes the robot's physical position uncertain.
- Persists operator edge/node closures and excludes them from shortest-path
  calculation for every new dispatch and route refresh.
- Raises a critical, deduplicated alarm if a new closure intersects an active
  route, without pretending that an already-issued robot command was revoked.
- Exposes closure create/list/clear controls through both `/api/v1` and the
  Fleet Management dashboard.
- Reserves available door/elevator bindings as `INFRASTRUCTURE` resources in
  the same conflict-free route transaction as edges and intersections.
- Treats unavailable transit infrastructure as a dynamic routing exclusion and
  alarms if an outage intersects a route already issued to a robot.

The full-route policy is deliberately conservative: because a mission owns its
complete path before dispatch, it cannot enter a hold-and-wait cycle with
another scheduled mission. This provides structural deadlock prevention for the
current graph model.

## Next responsibilities

Add priority preemption, rolling-horizon planning, infrastructure reservations,
and operator recovery controls for active-route closures.

## Boundaries

Does not perform onboard collision avoidance or safety-rated motion control.
Robot adapters must not begin movement before `scheduledStartAt`.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
