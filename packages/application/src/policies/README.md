# Application Policies

**Path:** packages/application/src/policies/

## Purpose

Contains replaceable business decision strategies.

## Responsibilities

Implement robot eligibility, assignment scoring, retry/timeout rules, charging policy, traffic priority, and reassignment policy.

## Boundaries

Policies must be deterministic by default and return explanations suitable for audit and operator display.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
