# ADR 0004: Offline robot safety holds

## Status

Accepted for Fleet recovery.

## Context

Network loss does not prove that a mobile robot has stopped. Automatically
releasing its traffic reservations or assigning the same mission to another
robot could create a collision or duplicate physical work.

## Decision

Fleet Core derives `DEGRADED` and `OFFLINE` from server-received heartbeat age.
When an assigned robot becomes offline, its mission transitions to
`RECOVERY_REQUIRED`, pending delivery is suspended, and all route resources are
converted to non-expiring `SAFETY_HOLD` reservations.

A reconnecting robot must report one of two states:

- The old mission remains active: restore the previous mission state and retain
  the conservative traffic hold until terminal completion.
- No command is active and the robot is available: quarantine the old robot,
  release the hold, requeue the mission, and dispatch it to another robot.

## Consequences

- A timeout alone cannot create duplicate mission execution.
- Uncertain factory space remains unavailable, reducing throughput in favor of
  safety.
- Operator recovery and physical verification are still required for cases
  where the robot cannot reconnect.
- Fleet recovery coordinates traffic but does not replace onboard safety-rated
  stopping or obstacle avoidance.
