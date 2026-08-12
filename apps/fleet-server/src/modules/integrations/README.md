# Factory Integrations Module

**Path:** apps/fleet-server/src/modules/integrations/

## Purpose

Connects Fleet Control to non-robot factory and enterprise systems.

## Responsibilities

Integrate MES, WMS, ERP, doors, lifts, conveyors, PLC gateways, and webhooks with idempotent external-reference mapping.

## Boundaries

Robot-vendor integrations belong in packages/adapters, not here.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
