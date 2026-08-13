# Missions Module

**Path:** apps/fleet-server/src/modules/missions/

## Purpose

Owns mission creation and the complete mission lifecycle.

## Responsibilities

Validate mission plans, execute state-machine transitions, handle pause/resume/cancel/retry intentions, and record mission events and failure reasons.

## Implemented cancellation flow

- Queued missions cancel locally without contacting a robot.
- Assigned commands that have not been accepted are removed from the pending outbox before robot and route release.
- Dispatched and executing missions remain `CANCELLING` until the adapter emits a `CANCELLED` confirmation.
- Traffic ownership is retained after adapter delivery failure or rejection, preventing another robot from entering uncertain space.
- Cancellation requests are idempotent and can be retried from the API or operator timeline.

## Boundaries

Must not select robots directly or embed vendor command formats.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
