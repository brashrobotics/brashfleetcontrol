# ADR 0002: Atomic PostgreSQL reservation and durable command outbox

## Status

Accepted

## Context

Fleet Core may run more than one process. A process can also stop after
reserving a robot but before delivering the command. Process-local mutexes and
in-memory repositories cannot protect either case.

## Decision

Persist robots, missions, decisions, and commands in PostgreSQL. During
dispatch, lock the mission row and robot candidates with `FOR UPDATE SKIP
LOCKED`, then write the robot reservation, mission assignment, decision, and
pending command in one transaction.

Call the robot adapter only after commit. Keep failed transports pending and
retry them after restart with the same command ID. Robot adapters must be
idempotent by command ID.

## Consequences

- Two Fleet Core processes cannot reserve the same robot concurrently.
- A crash cannot lose a committed command intent.
- Adapter calls remain outside database transactions.
- Delivery is at least once, so adapters must deduplicate commands.
- Locking every robot row is deliberately conservative for the initial Fleet
  Core. Later partitions or atomic claim queries can reduce contention without
  changing the application contract.
