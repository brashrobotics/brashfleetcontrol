# VDA 5050 Adapter

**Path:** packages/adapters/vda5050/

## Purpose

Integrates fleets or robots that implement the VDA 5050 protocol.

## Implemented profile

The adapter implements the BRASH reference profile for **VDA 5050 3.0.0** over
MQTT 3.1.1:

- topic layout `vda5050/v3/{manufacturer}/{serialNumber}/{topic}`
- QoS 0 `order`, `instantActions`, and `state`
- QoS 1 retained `connection`, including robot last will
- canonical `MOVE_TO`, `LOAD`, and `UNLOAD` to released VDA nodes, edges,
  `pick`, and `drop` actions
- `cancelOrder` instant action with correlated final action state
- order acceptance only after matching `state.orderId/orderUpdateId`
- state, pose, battery, operating mode, safety, error, mission, and connection
  normalization
- message sequencing, duplicate command fencing, reconnect reconciliation, and
  structural validation of every field used by the supported profile

Configured robot descriptors remain authoritative for capabilities. This is
intentional: customer-specific action semantics and physical limits must be
reviewed during onboarding and are not inferred from an arbitrary factsheet.

## Boundaries

VDA message types must not leak into Fleet domain, dispatch, or UI code. This
reference profile is not a claim of full vendor certification: horizon/base
updates, zone/edge requests, full factsheet validation, visualization,
manufacturer-specific actions, and official-schema interoperability evidence
remain customer integration gates.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
