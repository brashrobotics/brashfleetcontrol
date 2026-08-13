# Fleet Resilience Testing

Use five gates before promoting a release:

1. `npm test` verifies deterministic domain, API, security, workflow, recovery,
   adapter, and observability behavior.
2. `npm run test:postgres` verifies cross-instance exclusion and append-only
   constraints against PostgreSQL.
3. `npm run test:load && npm run test:chaos` verifies concurrency budgets and
   deterministic fault invariants.
4. `npm run test:soak` exercises the running HTTP deployment for the intended
   duration and request rate.
5. `npm run acceptance:digital-twin` executes versioned nominal throughput,
   congestion replanning, robot-loss recovery, and infrastructure-outage
   scenarios. It writes `artifacts/digital-twin-acceptance.json` and exits
   non-zero when any configured acceptance threshold fails.

Every scenario file under `tests/digital-twin/scenarios` is hashed into the
report. Keep customer-specific robot counts and thresholds in reviewed scenario
revisions so the test evidence can be tied to an exact release. Set `GIT_COMMIT`
in CI and archive the JSON report as a release artifact. `DIGITAL_TWIN_REPORT`
and `DIGITAL_TWIN_SCENARIO_DIRECTORY` can select a different output file or an
approved customer scenario catalog.

For a factory staging drill, run at least one full-shift soak with the expected
robot count. During the run inject adapter disconnects, kill a Fleet Core
instance, restart PostgreSQL through the approved HA mechanism, and close an
active traffic resource. Pass only if there is no duplicate physical mission,
no overlapping resource reservation, no silent audit gap, and every uncertain
robot route remains in a safety hold until explicit reconciliation.

Record the Git commit, database migration version, topology revision, adapter
versions, host sizing, request/telemetry rates, latency percentiles, error count,
and all alarm/audit correlations with the test report.

The in-process twin proves deterministic Fleet Core behavior; it is not a
physics or safety certification. Before factory acceptance, repeat the same
failure matrix against Gazebo/ROS 2 and the selected robot adapters, then perform
a supervised hardware-in-the-loop drill with safety-rated controls enabled.
