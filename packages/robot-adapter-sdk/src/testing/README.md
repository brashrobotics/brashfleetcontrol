# Adapter SDK Testing Utilities

**Path:** packages/robot-adapter-sdk/src/testing/

## Purpose

Provides reusable tools for testing adapter implementations.

## Responsibilities

Offer fake clocks, fake transports, sample states, command fixtures, contract assertions, and a shared conformance harness.

`FaultInjectingAdapter` wraps a hermetic vendor adapter and can inject call
delays, selected event loss, and execution/cancellation receipt loss. Receipt
loss happens after the delegate operation completed, so retries must reuse the
same `commandId` and return the original receipt rather than issuing a second
robot command.

## Boundaries

Utilities must not assume a specific vendor, protocol, or customer network.
Never run destructive certification commands against production robots.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
