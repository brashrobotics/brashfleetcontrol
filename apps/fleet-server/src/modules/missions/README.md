# Missions Module

**Path:** apps/fleet-server/src/modules/missions/

## Purpose

Owns mission creation and the complete mission lifecycle.

## Responsibilities

Validate mission plans, execute state-machine transitions, handle pause/resume/cancel/retry intentions, and record mission events and failure reasons.

## Boundaries

Must not select robots directly or embed vendor command formats.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
