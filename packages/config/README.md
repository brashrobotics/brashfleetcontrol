# Configuration Package

**Path:** packages/config/

## Purpose

Loads and validates runtime configuration shared by applications and adapters.

## Responsibilities

Define environment-variable schemas, defaults, typed site/adapter configuration, feature flags, and startup validation.

## Boundaries

Store schemas and non-secret defaults only; actual secrets come from the deployment environment or secret manager.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
