# Simulator Adapter Source

**Path:** packages/adapters/simulator/src/

## Purpose

Implements the canonical Robot Adapter contract for deterministic in-process simulated robots.

## Responsibilities

Provide idempotent command handling, explicit mission progress controls, state events, controlled failures, and optional automatic progression for local demos.

## Boundaries

The simulator adapter must exhibit asynchronous adapter semantics and must not bypass Fleet Core mission rules.

