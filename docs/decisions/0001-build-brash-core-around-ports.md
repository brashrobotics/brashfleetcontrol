# ADR 0001: Build BRASH Fleet Core Around Replaceable Ports

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

BRASH Fleet Control must support customer-selected AMRs and AGVs without making the product core dependent on a single robot vendor, ROS distribution, VDA 5050 version, or traffic engine. Open-RMF is valuable for complex traffic and building infrastructure but should not own BRASH mission, user, audit, and customer-integration models.

## Decision

BRASH will own the canonical robot, mission, assignment, and API models. External capabilities are connected through explicit ports:

- `RobotAdapter` for simulated, VDA 5050, REST, MQTT, and vendor-specific robot systems.
- `TrafficEngine` for a future simple BRASH graph engine or Open-RMF-backed traffic coordination.
- Repository, transaction, event, clock, and identity ports for infrastructure.

The first vertical slice uses an in-memory repository and deterministic SimulatorAdapter. PostgreSQL and Open-RMF are subsequent infrastructure implementations, not domain dependencies.

## Consequences

- Robot protocols cannot leak into mission or dispatch code.
- Adapter conformance tests become a required product asset.
- BRASH can deploy its backend without ROS 2 when no ROS-based integration is needed.
- More mapping and reconciliation code is required at adapter boundaries.
- Complex traffic negotiation may be delegated to Open-RMF without replacing Fleet Core.

