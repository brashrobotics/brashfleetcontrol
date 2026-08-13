# Dispatch Module

**Path:** apps/fleet-server/src/modules/dispatch/

## Purpose

Selects the most suitable eligible robot for each queued mission.

## Responsibilities

Apply hard eligibility filters, score candidates, record decision explanations, reserve the robot atomically, and handle rejection/retry policy.

## Implemented automatic queue

- Every queued mission has a durable scheduling record.
- Effective priority increases with waiting time to prevent starvation.
- Due attempts use bounded exponential retry backoff when no robot is eligible.
- Expiring worker leases and PostgreSQL `SKIP LOCKED` claims support active-active Fleet Core instances.
- Robot command rejection and confirmed recovery automatically reactivate the queue entry.
- `/api/v1/dispatch/queue` exposes pending work, effective priorities, retry timing, and lease state.

## Boundaries

Uses canonical robot and mission models; it must not depend on VDA 5050 or any vendor SDK.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
