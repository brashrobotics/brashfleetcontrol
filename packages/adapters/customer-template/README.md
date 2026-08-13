# Customer Adapter Template

**Path:** packages/adapters/customer-template/

## Purpose

Provides a safe starting point for a new customer or vendor integration.

## Responsibilities

Include example configuration, protocol mapping, adapter lifecycle, error mapping, coordinate conversion, fixtures, and conformance tests.

## Starting a customer integration

Implement two narrow ports in `src/mapped-robot-adapter.ts`:

- `VendorRobotDriver` owns network sessions, authentication, timeouts, broker or
  HTTP calls, and durable command lookup.
- `VendorProtocolMapper` is pure translation between vendor payloads and the
  canonical Fleet contracts.

Create `MappedRobotAdapter` with a unique manifest. The template validates every
descriptor, state, receipt, and event before it can reach Fleet Core. It also
fences in-process duplicate commands and forwards the Fleet `commandId` as the
vendor transport's idempotency key.

Production drivers must persist `commandId -> missionId` correlation. After a
process restart, `resolveMissionId` is used to cancel a command that Fleet Core
already delivered. The vendor endpoint or broker consumer must independently
deduplicate the same key; an in-memory cache alone is not sufficient.

Run the shared conformance suite before adding the adapter to a composite:

```ts
await assertAdapterConformance({
  createAdapter: () => createCustomerAdapter(testConfiguration),
});
```

## Boundaries

Never include real customer credentials, certificates, network addresses, or confidential payload samples.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
