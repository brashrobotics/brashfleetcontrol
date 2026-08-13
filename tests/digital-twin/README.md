# Digital-Twin Acceptance

The acceptance harness converts reviewed JSON scenario definitions into a
machine-readable release gate. It drives the deterministic simulator through
normal Fleet Core APIs and measures completion, duplicate command events,
reservation overlap, critical alarms, safety holds, recovery state, and route
revision behavior.

Run the fast test gate with `npm run test:digital-twin`. Run
`npm run acceptance:digital-twin` to also write the archival JSON report. A
scenario fails on an exception or a threshold violation, and the runner returns
a non-zero exit code suitable for CI.

Scenario hashes make definition drift visible. Do not weaken a threshold to
make a release pass without an approved change record and retained prior report.
Add site-specific topology, workload, outage, and recovery scenarios before a
customer factory acceptance test.
