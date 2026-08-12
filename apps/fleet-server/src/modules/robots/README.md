# Robots Module

**Path:** apps/fleet-server/src/modules/robots/

## Purpose

Manages the Fleet representation of registered robots independently of robot vendors.

## Responsibilities

Register and deactivate robots, normalize state, track connectivity, store capabilities and constraints, and verify active-mission consistency.

## Boundaries

Does not control motors, local navigation, obstacle avoidance, or physical safety.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
