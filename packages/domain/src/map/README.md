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

## Publication and infrastructure

The application/persistence boundary wraps each topology in an immutable map
version record. Draft revisions can be reviewed before publication; retired
revisions remain queryable history and cannot receive new missions.

Factory infrastructure is catalogued outside the graph JSON so operational
status can change without mutating a published topology. Door and elevator
bindings feed the traffic scheduler as exclusive resources. Charger, dock, and
workcell bindings are reserved by the workflow layer.

## Future model

Add Site, Building, Floor, semantic zone policy, and coordinate-frame metadata
around the versioned traffic graph.

## Boundaries

Rendering assets and vendor coordinate conversion implementations do not belong here.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
