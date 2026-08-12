# Dispatch Module

**Path:** apps/fleet-server/src/modules/dispatch/

## Purpose

Selects the most suitable eligible robot for each queued mission.

## Responsibilities

Apply hard eligibility filters, score candidates, record decision explanations, reserve the robot atomically, and handle rejection/retry policy.

## Boundaries

Uses canonical robot and mission models; it must not depend on VDA 5050 or any vendor SDK.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
