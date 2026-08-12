CREATE TABLE mission_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions (mission_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN (
      'MISSION_QUEUED', 'ASSIGNMENT_NOT_FOUND', 'MISSION_ASSIGNED',
      'COMMAND_DELIVERY_FAILED', 'COMMAND_DISPATCHED', 'COMMAND_REJECTED',
      'MISSION_EXECUTING', 'MISSION_COMPLETED', 'MISSION_FAILED', 'MISSION_CANCELLED'
    )
  ),
  mission_state text NOT NULL CHECK (
    mission_state IN (
      'CREATED', 'QUEUED', 'ASSIGNED', 'DISPATCHED', 'EXECUTING',
      'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED'
    )
  ),
  robot_id text REFERENCES robots (robot_id),
  command_id text,
  message text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(event_data) = 'object'),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX mission_events_mission_timeline_idx
  ON mission_events (mission_id, occurred_at, event_id);

ALTER TABLE command_outbox
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz;

UPDATE command_outbox
SET next_attempt_at = COALESCE(last_attempt_at, created_at)
WHERE next_attempt_at IS NULL;

ALTER TABLE command_outbox
  ALTER COLUMN next_attempt_at SET NOT NULL;

DROP INDEX command_outbox_pending_idx;

CREATE INDEX command_outbox_pending_idx
  ON command_outbox (next_attempt_at, created_at, command_id)
  WHERE status = 'PENDING';
