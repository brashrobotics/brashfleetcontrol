# REST Robot Adapter

**Path:** packages/adapters/rest/

## Purpose

Provides shared infrastructure for robot systems exposed through REST APIs.

## Responsibilities

Handle authentication, polling or webhooks, request timeouts, safe retries, rate limits, model mapping, and health checks.

## Boundaries

Create a dedicated vendor adapter when conditionals or semantics exceed a generic mapping layer.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
