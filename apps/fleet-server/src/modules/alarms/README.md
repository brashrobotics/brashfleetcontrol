# Alarms Module

**Path:** apps/fleet-server/src/modules/alarms/

## Purpose

Maintains actionable operational conditions that operators must see or acknowledge.

## Responsibilities

Create, deduplicate, classify, acknowledge, and close alarms linked to robots, missions, commands, maps, or infrastructure.

## Boundaries

Alarms describe operational conditions; immutable user actions belong in audit.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
