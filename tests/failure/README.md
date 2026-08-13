# Failure and Recovery Tests

**Path:** tests/failure/

## Purpose

Verifies behavior during infrastructure and robot faults.

## Implemented scenarios

- Robot heartbeat degradation/offline transition and conservative traffic holds.
- Reconnection with an active command versus confirmed-clear reassignment.
- Pending command recovery across process restart with the same command ID.
- Duplicate/out-of-order telemetry storms that cannot regress canonical state.
- Workflow worker crash simulation through lease expiry and safe takeover.
- Audit database outage that rejects a mutation before domain state changes.
- PostgreSQL multi-instance robot, queue, workflow, route, recovery, and audit
  contention is covered by `npm run test:postgres`.

## Boundaries

Assert safe state reconciliation and prevention of duplicate physical work, not merely service availability.

Run deterministic chaos checks with `npm run test:chaos`. These tests do not
replace infrastructure-level network partition, disk pressure, process kill,
and database failover drills in the staging environment.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
