# REST Robot Adapter

**Path:** packages/adapters/rest/

## Purpose

Provides a production-shaped canonical HTTP boundary for robot systems and the
out-of-process BRASH robot emulator.

## Responsibilities

`HttpRobotAdapter` handles bearer authentication, operation deadlines, robot
discovery, state polling, ordered event polling, command correlation, canonical
validation, mission execution, cancellation, and transport reconnects.

Configure it with `FLEET_ROBOT_ADAPTER=http` and
`FLEET_ROBOT_ADAPTER_URL=http://127.0.0.1:4280` for local development. HTTPS is
required for non-loopback endpoints unless the caller explicitly enables the
isolated-development override.

## Boundaries

This protocol carries BRASH canonical contracts. Create a dedicated mapping
adapter when a vendor API, MQTT dialect, or VDA 5050 endpoint uses different
semantics. Network transport acceptance never replaces robot mission acceptance
or an independent safety function.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
