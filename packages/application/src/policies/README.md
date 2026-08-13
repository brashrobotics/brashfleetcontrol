# Application Policies

**Path:** packages/application/src/policies/

## Purpose

Contains replaceable business decision strategies.

## Responsibilities

Implement robot eligibility, assignment scoring, retry/timeout rules, charging policy, traffic priority, and reassignment policy.

## Boundaries

Policies must be deterministic by default and return explanations suitable for audit and operator display.

`WorkOrderAllocationPolicy` first applies hard capability, payload, map, zone,
battery, connection, and availability constraints. It then ranks eligible
robots by pickup distance, battery penalty, and capability surplus, with robot
ID as a deterministic tie-breaker.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
