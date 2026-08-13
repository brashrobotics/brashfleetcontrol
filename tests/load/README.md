# Load and Performance Tests

**Path:** tests/load/

## Purpose

Measures Fleet behavior under expected and peak operating load.

## Implemented scenarios

- `load-harness.ts` runs bounded-concurrency operations and reports throughput,
  errors, and min/p50/p95/p99/max latency.
- `fleet-api-load.test.ts` executes 1,000 snapshot reads at concurrency 50 and
  200 concurrent idempotent mission submissions at concurrency 25.
- The development acceptance budget is zero errors and p95 below 250 ms for the
  in-process Node.js test on a developer workstation. It is a regression guard,
  not a factory capacity claim.
- `npm run test:soak` runs mixed authenticated HTTP reads against a live Fleet
  server. Configure `FLEET_BASE_URL`, `FLEET_TOKEN`, `SOAK_DURATION_SECONDS`,
  `SOAK_REQUESTS_PER_SECOND`, and `SOAK_MAX_P99_MS`.

## Boundaries

Every scenario must state hardware assumptions, dataset size, target thresholds, and reproducibility instructions.
Before a customer release, rerun equivalent profiles against the production
PostgreSQL topology, expected robot count, adapter latency, and HA instance count.

## Commands

```bash
npm run test:load
SOAK_DURATION_SECONDS=3600 SOAK_REQUESTS_PER_SECOND=25 npm run test:soak
```

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
