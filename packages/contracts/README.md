# Contracts Package

**Path:** packages/contracts/

## Purpose

Provides the versioned source of truth for data crossing system boundaries.

## Responsibilities

Own OpenAPI, JSON Schema, event schemas, compatibility rules, and generated types.

## Boundaries

Internal implementation types must not silently become public contracts.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
