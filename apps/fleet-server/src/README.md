# Fleet Server Source

**Path:** apps/fleet-server/src/

## Purpose

Contains the Fleet Server implementation organized by runtime composition, transport, business modules, and workers.

## Responsibilities

Keep the executable source modular and make dependencies explicit at the composition boundary.

## Boundaries

Do not use this directory as a general shared-library location.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
