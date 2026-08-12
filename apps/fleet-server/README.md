# Fleet Server

**Path:** apps/fleet-server/

## Purpose

The primary backend process for Fleet API access, real-time updates, persistence, and background work.

## Responsibilities

Start the HTTP server, connect infrastructure, register adapters, expose health checks, and shut down gracefully.

## Boundaries

Business rules belong in domain/application packages; robot protocols belong in adapters.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
