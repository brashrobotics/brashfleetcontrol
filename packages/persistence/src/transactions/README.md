# Persistence Transactions

**Path:** packages/persistence/src/transactions/

## Purpose

Provides transaction boundaries, locks, and concurrency controls.

## Responsibilities

Support atomic robot/mission reservation, row or advisory locks, retryable serialization failures, and multi-repository work.

## Boundaries

Lock duration and ordering must be documented to prevent deadlocks and hidden contention.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.

## Locking protocol

Dispatch locks in this order:

1. The target mission row with `FOR UPDATE`.
2. Robot rows ordered by `robot_id` with `FOR UPDATE SKIP LOCKED`.
3. The selected robot is reserved and the mission is assigned.
4. The command outbox row and assignment decision are inserted.
5. The transaction commits before any adapter network call.

The stable robot ordering reduces deadlock risk. `SKIP LOCKED` lets another
Fleet Core instance consider a different robot instead of waiting for a robot
already being assigned.
