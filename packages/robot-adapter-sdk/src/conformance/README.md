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
4. Rejection when a `commandId` is reused with different command content.
5. Safe recovery when the robot accepted a command but the first receipt was
   lost at the transport boundary.
6. Stable cancellation receipts, a correlated `CANCELLED` event, and an
   `AVAILABLE` post-cancellation robot state.
7. Accepted command ownership and the original receipt survive reconnect.
8. Robot state sequences advance and never regress.
9. Connect, discovery, state polling, and disconnect meet the configured
   operation deadline.

Successful reports can be converted to a tamper-evident certificate with
`issueAdapterCertificate(report, approvedBy, signingKey)`. The certificate
embeds the complete report, adapter and protocol versions, approver, issue and
expiry dates, and an HMAC-SHA256 signature. Keep the signing key outside source
control and verify the certificate before allowing an adapter build into a
production deployment. A new adapter version must be certified again.

`FaultInjectingAdapter` is also exported for vendor test suites. It can drop an
execution or cancellation receipt *after* the underlying operation completed,
delay calls, and suppress selected events. This makes ambiguous network
outcomes reproducible without destabilizing real robots.

The factory must return at least one `ONLINE` and `AVAILABLE` test robot. A
vendor adapter should run this suite against a hermetic driver or test tenant in
CI; never point conformance tests at a production robot.

## Boundaries

An adapter cannot be enabled for production until its conformance suite passes.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
