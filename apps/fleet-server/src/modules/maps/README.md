# Maps Module

**Path:** apps/fleet-server/src/modules/maps/

## Purpose

Owns versioned factory topology and semantic location data used by Fleet planning.

## Responsibilities

Manage sites, buildings, floors, map versions, stations, zones, traffic graphs, infrastructure resources, and coordinate-transform metadata.

## Boundaries

Map changes must be versioned; published versions must not be silently mutated.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
