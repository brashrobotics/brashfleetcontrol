# Legacy Site Worker

**Path:** worker/

## Purpose

Contains the current hosting worker used by the demo deployment.

## Responsibilities

Maintain only compatibility fixes required while the existing demo remains deployed.

## Boundaries

New Fleet background processing belongs in apps/fleet-server/src/workers, not in this legacy hosting worker.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
