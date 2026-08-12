# Simulator Engine

**Path:** apps/robot-simulator/src/engine/

## Purpose

Implements simulated time, robot movement, mission execution, and state publication.

## Responsibilities

Advance deterministic state, model mission acceptance/completion, battery consumption, charging, and configurable timing.

## Boundaries

All nondeterminism must be controlled by an explicit seed or injected clock.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
