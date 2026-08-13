# Robot Adapter Integration Guide

BRASH Fleet Core speaks one canonical `RobotAdapter` contract. Vendor REST,
MQTT, VDA 5050, ROS 2, and proprietary payloads terminate at this boundary and
must not leak into dispatch, traffic, mission, persistence, or dashboard code.

## Integration sequence

1. Assign a stable lowercase adapter ID and create an `AdapterManifest`.
2. Implement a protocol driver for connection lifecycle and transport I/O.
3. Implement pure mappings for robot descriptors, state, commands, receipts,
   cancellations, and asynchronous events.
4. Map vendor capabilities explicitly to canonical action names and constraints.
5. Preserve Fleet `commandId` as the vendor idempotency key and persist the
   `commandId -> missionId` ledger across adapter restarts.
6. Run `assertAdapterConformance` against a hermetic test robot or simulator.
7. Combine multiple vendor adapters with `CompositeRobotAdapter` and pass that
   single adapter to Fleet Core.

## Runtime boundary

```text
Fleet Core
    |
CompositeRobotAdapter
    |-- Customer A REST adapter -- REST driver -- Customer A robots
    |-- Customer B VDA adapter  -- MQTT driver -- Customer B robots
    `-- Simulator adapter       -- in-process  -- test robots
```

The composite discovers ownership by robot ID and routes execution,
cancellation, state reads, and events to the correct child. Startup fails if two
adapters claim the same robot ID.

## Mandatory guarantees

- `connect` and `disconnect` are explicit and repeat-safe.
- State is canonical, finite, timestamped, sequenced, and correlated to a known
  descriptor.
- Reusing a `commandId` with the same content returns the original receipt and
  does not execute twice.
- Reusing a `commandId` with different content is rejected.
- Cancellation is idempotent and emits a correlated terminal event.
- Network acceptance is not robot mission acceptance; only a canonical receipt
  changes the Fleet delivery state.
- Robot local obstacle avoidance and safety-rated control remain onboard.

The reference implementations and contract tests are under
`packages/adapters/simulator`, `packages/adapters/customer-template`, and
`tests/contract`.
