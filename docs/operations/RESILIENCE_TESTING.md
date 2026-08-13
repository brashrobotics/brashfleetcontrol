# Fleet Resilience Testing

Use four gates before promoting a release:

1. `npm test` verifies deterministic domain, API, security, workflow, recovery,
   adapter, and observability behavior.
2. `npm run test:postgres` verifies cross-instance exclusion and append-only
   constraints against PostgreSQL.
3. `npm run test:load && npm run test:chaos` verifies concurrency budgets and
   deterministic fault invariants.
4. `npm run test:soak` exercises the running HTTP deployment for the intended
   duration and request rate.

For a factory staging drill, run at least one full-shift soak with the expected
robot count. During the run inject adapter disconnects, kill a Fleet Core
instance, restart PostgreSQL through the approved HA mechanism, and close an
active traffic resource. Pass only if there is no duplicate physical mission,
no overlapping resource reservation, no silent audit gap, and every uncertain
robot route remains in a safety hold until explicit reconciliation.

Record the Git commit, database migration version, topology revision, adapter
versions, host sizing, request/telemetry rates, latency percentiles, error count,
and all alarm/audit correlations with the test report.
