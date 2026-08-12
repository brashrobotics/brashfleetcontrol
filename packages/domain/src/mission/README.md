# Mission Domain

**Path:** packages/domain/src/mission/

## Purpose

Defines missions, steps, priorities, lifecycle rules, and mission events.

## Responsibilities

Model Mission, MissionId, MissionStep, assignment state, execution state, and valid pause/cancel/retry/complete transitions.

## Boundaries

A mission describes intent and constraints; it does not contain vendor command payloads.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
