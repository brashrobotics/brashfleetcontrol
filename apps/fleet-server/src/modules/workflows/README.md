# Workflows Module

**Path:** `apps/fleet-server/src/modules/workflows/`

## Purpose

Runs durable, dependency-aware factory operations above individual transport missions.

## Implemented vertical slice

- Validates workflow steps as a directed acyclic graph before persistence.
- Supports `TRANSPORT`, `WAIT`, `CHARGE`, `INSPECT`, and `DOCK` steps.
- Claims runnable steps with expiring worker leases, including PostgreSQL
  `SKIP LOCKED` coordination across Fleet Core instances.
- Applies per-step timeouts, bounded retries, and retry delay without blocking a worker.
- Correlates transport steps with durable Fleet missions and reuses their normal
  dispatch, traffic, cancellation, and recovery behavior.
- Serializes service steps through exclusive charger, dock, or workcell reservations.
- Fails fast after final step failure and cancels unstarted sibling steps.
- Exposes create, list, detail, and cancellation operations under `/api/v1/workflows`.
- Stores immutable `templateKey@version` catalog entries with draft, published,
  and retired lifecycle states under `/api/v1/workflow-templates`.
- Expands declared `{{parameterName}}` values with required/default/allow-list
  constraints, then revalidates the resulting workflow contract before creation.

## Boundaries

The workflow engine coordinates high-level steps. Robot navigation and actuator
behavior remain behind robot adapters. It never bypasses mission, traffic, resource,
or safety state machines.

## Operational behavior

`workflow-worker.ts` polls due steps. A process crash only leaves an expiring lease;
another worker resumes the step after lease expiry. Step external references include
the workflow, step, and attempt so mission creation remains idempotent.

## Next responsibilities

Add conditional branches, human approval steps, and compensation policies.
