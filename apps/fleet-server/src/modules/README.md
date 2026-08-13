# Fleet Server Modules

**Path:** apps/fleet-server/src/modules/

## Purpose

Groups product capabilities by business area while the system remains a modular monolith.

## Responsibilities

Provide clear module entry points and isolate robots, missions, workflows, work-order orchestration, dispatch, traffic, maps, charging, alarms, identity, audit, and integrations.

The current [orchestrator module](./orchestrator/README.md) accepts factory intent, evaluates heterogeneous robots, and compiles the selected execution into durable workflows.

## Boundaries

Modules communicate through explicit application contracts rather than reaching into each other's storage.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
