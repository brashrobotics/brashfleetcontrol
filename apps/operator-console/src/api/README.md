# Operator Console API Client

**Path:** apps/operator-console/src/api/

## Purpose

Implements typed communication with Fleet Server.

## Responsibilities

Provide REST calls, SSE/WebSocket subscriptions, authentication-token handling, model mapping, retries where safe, and shared error handling.

## Boundaries

Use published contracts; do not depend on backend implementation modules.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
