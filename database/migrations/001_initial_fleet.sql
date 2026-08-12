CREATE TABLE robots (
  robot_id text PRIMARY KEY,
  display_name text NOT NULL,
  vendor text NOT NULL,
  model text NOT NULL,
  capabilities jsonb NOT NULL CHECK (jsonb_typeof(capabilities) = 'array'),
  max_payload_kg numeric(12, 3) NOT NULL CHECK (max_payload_kg >= 0),
  allowed_zones jsonb NOT NULL CHECK (jsonb_typeof(allowed_zones) = 'array'),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  observed_at timestamptz NOT NULL,
  connection text NOT NULL CHECK (connection IN ('ONLINE', 'OFFLINE')),
  availability text NOT NULL CHECK (
    availability IN ('AVAILABLE', 'RESERVED', 'EXECUTING', 'CHARGING', 'ERROR', 'MANUAL')
  ),
  battery_percent numeric(5, 2) NOT NULL CHECK (battery_percent BETWEEN 0 AND 100),
  map_id text NOT NULL,
  pose_x double precision NOT NULL,
  pose_y double precision NOT NULL,
  pose_yaw double precision NOT NULL,
  active_mission_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX robots_dispatch_idx
  ON robots (availability, connection, robot_id);

CREATE TABLE missions (
  mission_id text PRIMARY KEY,
  mission_type text NOT NULL DEFAULT 'TRANSPORT' CHECK (mission_type = 'TRANSPORT'),
  external_reference text,
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 100),
  required_capabilities jsonb NOT NULL CHECK (jsonb_typeof(required_capabilities) = 'array'),
  payload_kg numeric(12, 3) NOT NULL CHECK (payload_kg >= 0),
  pickup jsonb NOT NULL CHECK (jsonb_typeof(pickup) = 'object'),
  dropoff jsonb NOT NULL CHECK (jsonb_typeof(dropoff) = 'object'),
  state text NOT NULL CHECK (
    state IN (
      'CREATED', 'QUEUED', 'ASSIGNED', 'DISPATCHED', 'EXECUTING',
      'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED'
    )
  ),
  assigned_robot_id text REFERENCES robots (robot_id),
  command_id text,
  failure_reason text,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX missions_external_reference_uidx
  ON missions (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX missions_state_priority_idx
  ON missions (state, priority DESC, created_at, mission_id);

CREATE TABLE assignment_decisions (
  decision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions (mission_id),
  selected_robot_id text REFERENCES robots (robot_id),
  selected_score double precision,
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array'),
  decided_at timestamptz NOT NULL
);

CREATE INDEX assignment_decisions_mission_idx
  ON assignment_decisions (mission_id, decided_at DESC, decision_id DESC);

CREATE TABLE command_outbox (
  command_id text PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions (mission_id),
  robot_id text NOT NULL REFERENCES robots (robot_id),
  command_payload jsonb NOT NULL CHECK (jsonb_typeof(command_payload) = 'object'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error text,
  receipt jsonb CHECK (receipt IS NULL OR jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX command_outbox_pending_idx
  ON command_outbox (created_at, command_id)
  WHERE status = 'PENDING';
