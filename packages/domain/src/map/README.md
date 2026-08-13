# Map Domain

**Path:** packages/domain/src/map/

## Purpose

Defines versioned sites, floors, stations, zones, and spatial references.

## Current model

`MapTopology` owns one immutable-in-use graph revision. It validates unique node
and edge identifiers, edge endpoints, positive traversal costs, and station
bindings. It provides deterministic shortest paths and nearest-node lookup for
coordinates that do not identify a known station.

The graph includes waypoint, intersection, station, and holding-point nodes;
edges may be one-way or bidirectional.

## Future model

Add Site, Building, Floor, MapVersion publication state, semantic zones, and
coordinate-frame metadata around this traffic graph.

## Boundaries

Rendering assets and vendor coordinate conversion implementations do not belong here.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
