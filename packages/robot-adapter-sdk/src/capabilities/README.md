# Canonical Capabilities

**Path:** packages/robot-adapter-sdk/src/capabilities/

## Purpose

Defines the shared vocabulary used to match missions with robots.

## Responsibilities

Model standard capability names, parameters, payload constraints, tools/attachments, operating zones, and vendor-to-canonical mapping helpers.

Use `mapVendorCapabilities` with an explicit mapping table. Unknown vendor
actions are ignored, names and zones are normalized, duplicate values are
removed, and an empty mapping is rejected. The canonical starter vocabulary is
exported as `CANONICAL_ROBOT_ACTIONS`; deployments may add namespaced actions
without changing Fleet Core.

Published Fleet capability profiles additionally declare dimensions, floor
compatibility, tools/attachments, cancellation support, and adapter protocol
version. Assign profiles only after adapter conformance and physical model
review; Fleet Core rejects profile changes while a robot owns work.

## Boundaries

Avoid unstructured free-text capabilities for constraints that affect assignment correctness.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
