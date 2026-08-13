ALTER TABLE robots
  DROP CONSTRAINT robots_connection_check;

ALTER TABLE robots
  ADD CONSTRAINT robots_connection_check CHECK (connection IN ('ONLINE', 'DEGRADED', 'OFFLINE')),
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN connection_changed_at timestamptz;

UPDATE robots
SET last_seen_at = observed_at,
    connection_changed_at = observed_at
WHERE last_seen_at IS NULL OR connection_changed_at IS NULL;

ALTER TABLE robots
  ALTER COLUMN last_seen_at SET NOT NULL,
  ALTER COLUMN connection_changed_at SET NOT NULL;

CREATE INDEX robots_liveness_idx
  ON robots (connection, last_seen_at, robot_id);

ALTER TABLE command_outbox
  DROP CONSTRAINT command_outbox_status_check;

ALTER TABLE command_outbox
  ADD CONSTRAINT command_outbox_status_check CHECK (
    status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')
  );

ALTER TABLE missions
  DROP CONSTRAINT missions_state_check;

ALTER TABLE missions
  ADD CONSTRAINT missions_state_check CHECK (
    state IN (
      'CREATED', 'QUEUED', 'ASSIGNED', 'DISPATCHED', 'EXECUTING',
      'RECOVERY_REQUIRED', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED'
    )
  ),
  ADD COLUMN recovery_previous_state text CHECK (
    recovery_previous_state IS NULL OR recovery_previous_state IN ('ASSIGNED', 'DISPATCHED', 'EXECUTING')
  ),
  ADD COLUMN recovery_started_at timestamptz;

ALTER TABLE mission_events
  DROP CONSTRAINT mission_events_event_type_check,
  DROP CONSTRAINT mission_events_mission_state_check;

ALTER TABLE mission_events
  ADD CONSTRAINT mission_events_event_type_check CHECK (
    event_type IN (
      'MISSION_QUEUED', 'ASSIGNMENT_NOT_FOUND', 'MISSION_ASSIGNED',
      'ROUTE_RESERVED', 'ROUTE_DELAYED', 'ROUTE_RELEASED',
      'ROBOT_CONNECTION_DEGRADED', 'ROBOT_OFFLINE',
      'MISSION_RECOVERY_REQUIRED', 'MISSION_RECOVERED', 'MISSION_RECOVERY_REQUEUED',
      'TRAFFIC_SAFETY_HOLD',
      'COMMAND_DELIVERY_FAILED', 'COMMAND_DISPATCHED', 'COMMAND_REJECTED',
      'MISSION_EXECUTING', 'MISSION_COMPLETED', 'MISSION_FAILED', 'MISSION_CANCELLED'
    )
  ),
  ADD CONSTRAINT mission_events_mission_state_check CHECK (
    mission_state IN (
      'CREATED', 'QUEUED', 'ASSIGNED', 'DISPATCHED', 'EXECUTING',
      'RECOVERY_REQUIRED', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED'
    )
  );

ALTER TABLE traffic_route_plans
  DROP CONSTRAINT traffic_route_plans_status_check;

ALTER TABLE traffic_route_plans
  ADD CONSTRAINT traffic_route_plans_status_check CHECK (status IN ('ACTIVE', 'SAFETY_HOLD', 'RELEASED')),
  ADD COLUMN last_renewed_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz;

UPDATE traffic_route_plans
SET last_renewed_at = planned_at,
    lease_expires_at = GREATEST(expected_arrival_at, planned_at + interval '45 seconds')
WHERE last_renewed_at IS NULL OR lease_expires_at IS NULL;

ALTER TABLE traffic_route_plans
  ALTER COLUMN last_renewed_at SET NOT NULL,
  ALTER COLUMN lease_expires_at SET NOT NULL;

CREATE INDEX traffic_route_plans_lease_idx
  ON traffic_route_plans (status, lease_expires_at, route_id)
  WHERE status IN ('ACTIVE', 'SAFETY_HOLD');

ALTER TABLE traffic_reservations
  DROP CONSTRAINT traffic_reservations_state_check;

ALTER TABLE traffic_reservations
  ADD CONSTRAINT traffic_reservations_state_check CHECK (
    state IN ('ACTIVE', 'SAFETY_HOLD', 'RELEASED')
  );
