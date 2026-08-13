# Maps Module

**Path:** apps/fleet-server/src/modules/maps/

## Purpose

Owns versioned factory topology and semantic location data used by Fleet planning.

## Implemented vertical slice

- `MapTopology` validates nodes, edges, station bindings, and map revisions.
- Directed and undirected edges are supported.
- Deterministic Dijkstra routing minimizes configured edge travel time.
- `plant-a@1` is bootstrapped in memory and PostgreSQL for development.
- `GET /api/v1/maps` and `GET /api/v1/maps/:mapId/topology` expose the graph.
- Map families now have immutable `DRAFT`, `PUBLISHED`, and `RETIRED`
  revisions. Mission creation accepts published revisions only.
- Draft creation, publication, safe retirement, and revision history are
  exposed through `/api/v1/map-versions`.
- Doors, elevators, chargers, docks, and workcells are stored as typed factory
  infrastructure bound to a topology edge or node.
- Door/elevator transit resources participate in route reservations. A resource
  outage excludes its binding from new routes and alarms any active reservation.

## Next responsibilities

Add site/building/floor hierarchy, semantic zone policy, coordinate transforms,
and rendering asset storage.

## Boundaries

Map changes must be versioned; published versions cannot be silently mutated.
A published revision cannot be retired while a mission or robot still reports it,
and a family must retain at least one published revision.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
