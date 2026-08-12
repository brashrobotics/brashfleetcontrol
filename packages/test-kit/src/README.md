# Test Kit Source

**Path:** packages/test-kit/src/

## Purpose

Contains deterministic Fleet fixtures, clocks, IDs, and complete test-system builders.

## Responsibilities

Make domain, adapter, API, and end-to-end tests concise without hiding important behavior.

## Boundaries

Test helpers may depend on product packages; production packages must never depend on the test kit.

