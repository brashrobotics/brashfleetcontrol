# Simulator Fault Injection

**Path:** apps/robot-simulator/src/faults/

## Purpose

Defines controlled failure modes for reliability testing.

## Responsibilities

Inject disconnects, delayed or out-of-order telemetry, mission rejection, stuck execution, robot errors, and command timeouts.

## Boundaries

Faults must be reproducible and observable, with explicit activation and recovery conditions.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
