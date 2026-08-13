# Adapter Conformance Rules

**Path:** packages/robot-adapter-sdk/src/conformance/

## Purpose

Defines mandatory behavioral requirements for an adapter.

## Responsibilities

Verify connection lifecycle, acknowledgments, duplicate-command handling, timestamp/order rules, timeout behavior, state normalization, and error mapping.

`assertAdapterConformance({ createAdapter })` creates isolated adapter instances
and verifies:

1. Manifest and SDK compatibility.
2. Explicit connect/disconnect behavior and canonical inventory.
3. Stable receipts when `executeMission` is repeated with the same `commandId`.
4. Stable cancellation receipts, a correlated `CANCELLED` event, and an
   `AVAILABLE` post-cancellation robot state.

The factory must return at least one `ONLINE` and `AVAILABLE` test robot. A
vendor adapter should run this suite against a hermetic driver or test tenant in
CI; never point conformance tests at a production robot.

## Boundaries

An adapter cannot be enabled for production until its conformance suite passes.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
