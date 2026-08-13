# Fleet Observability Runbook

## FleetApiHighErrorRate

Filter JSON logs by `event=http.request.completed`, then group by normalized
`route`, `status`, and `correlationId`. Check PostgreSQL and adapter health before
retrying a failed mutation; its audit history determines whether it executed.

## FleetRobotOffline

Open the robot detail and alarm panels, verify heartbeat age, then inspect the
mission route for a red safety hold. Do not release traffic ownership until the
robot reports whether its previous command is still active.

## FleetMissionQueueStalled

Inspect capability, payload, map, zone, availability, and battery rejection
reasons. Confirm that at least one compatible adapter is online before changing
priority or cancelling work.

## FleetCriticalAlarmOpen

Acknowledge the alarm to establish operator ownership, investigate its source,
and resolve the underlying condition. Acknowledgement alone does not clear it.
