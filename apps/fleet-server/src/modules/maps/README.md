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

## Next responsibilities

Add a publish/draft lifecycle, site/building/floor hierarchy, semantic zones,
infrastructure resources, coordinate transforms, and immutable revision history.

## Boundaries

Map changes must be versioned; published versions must not be silently mutated.
The current API is read-only and startup only seeds a missing development map.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
