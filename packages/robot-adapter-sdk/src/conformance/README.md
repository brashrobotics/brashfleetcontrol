# Adapter Conformance Rules

**Path:** packages/robot-adapter-sdk/src/conformance/

## Purpose

Defines mandatory behavioral requirements for an adapter.

## Responsibilities

Verify connection lifecycle, acknowledgments, duplicate-command handling, timestamp/order rules, timeout behavior, state normalization, and error mapping.

## Boundaries

An adapter cannot be enabled for production until its conformance suite passes.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
