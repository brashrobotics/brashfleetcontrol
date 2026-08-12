# Simulator Adapter

**Path:** packages/adapters/simulator/

## Purpose

Connects Fleet Control to the vendor-independent robot simulator.

## Responsibilities

Translate canonical commands to simulator actions, normalize simulator state, and serve as the reference adapter implementation.

## Boundaries

Must behave like a real asynchronous adapter, including acknowledgments, delays, failures, and reconnects.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
