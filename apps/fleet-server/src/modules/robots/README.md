# Robots Module

**Path:** apps/fleet-server/src/modules/robots/

## Purpose

Manages the Fleet representation of registered robots independently of robot vendors.

## Current implementation

Fleet Core records both robot-observed telemetry time and server-received
`lastSeenAt`. `RobotLivenessPolicy` derives `DEGRADED` after 10 seconds without
contact and `OFFLINE` after 30 seconds. Only `ONLINE` robots are dispatchable.

An offline robot with an active mission triggers `RECOVERY_REQUIRED`; Fleet
Core does not assume that a disconnected robot stopped moving. Reconnection can
resume the existing mission or explicitly clear and fence the old robot before
the mission is requeued.

Future work includes configurable per-adapter thresholds, clock-skew metrics,
manual recovery approval, and robot deactivation.

## Boundaries

Does not control motors, local navigation, obstacle avoidance, or physical safety.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
