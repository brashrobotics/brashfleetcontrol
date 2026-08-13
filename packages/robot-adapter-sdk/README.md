# Robot Adapter SDK

**Path:** packages/robot-adapter-sdk/

## Purpose

Standardizes how physical or simulated robot systems integrate with Fleet Control.

## Responsibilities

Provide the canonical adapter interface, capability vocabulary, conformance checks, test utilities, lifecycle guidance, and integration examples.

## Implemented SDK surface

- `RobotAdapter` plus a required, versioned `AdapterManifest`.
- Canonical descriptor, state, receipt, event, and inventory validators.
- Canonical capability normalization and explicit vendor-to-Fleet mapping.
- `CompositeRobotAdapter` for routing commands to multiple vendor adapters while
  rejecting duplicate robot ownership.
- `runAdapterConformance` and `assertAdapterConformance` for mandatory lifecycle,
  inventory, idempotency, cancellation, and event-correlation checks.
- A mapped customer adapter template that keeps vendor payloads outside Fleet
  Core and forwards `commandId` as the transport idempotency key.

## Boundaries

The SDK abstracts vendor protocols; it does not implement Fleet dispatch or onboard navigation.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.

An adapter is eligible for a customer deployment only when its manifest is
reviewed, the shared conformance report is fully green, and its command ledger
survives process restart.
