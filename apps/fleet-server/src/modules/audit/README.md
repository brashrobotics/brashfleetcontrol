# Audit Module

**Path:** apps/fleet-server/src/modules/audit/

## Purpose

Provides an immutable history of security-sensitive and operator-initiated changes.

## Responsibilities

Record actor, action, target, old/new values, timestamp, and correlation ID for missions, assignments, configuration, and permissions.

## Boundaries

Audit events are not ordinary debug logs and must not be silently edited or deleted.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
