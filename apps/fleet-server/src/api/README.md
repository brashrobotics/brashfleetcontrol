# Fleet API Transport

**Path:** apps/fleet-server/src/api/

## Purpose

Exposes HTTP and real-time interfaces to operator clients and external systems.

## Responsibilities

Define routes, validate requests, map errors, enforce authentication/authorization, manage SSE or WebSocket connections, and attach correlation IDs.

## Boundaries

Handlers call application use cases; they do not execute SQL or implement domain rules.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
