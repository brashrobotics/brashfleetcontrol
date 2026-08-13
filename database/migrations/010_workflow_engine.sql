CREATE TABLE workflows (
  workflow_id text PRIMARY KEY,
  name text NOT NULL,
  external_reference text,
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure_reason text
);

CREATE UNIQUE INDEX workflows_external_reference_uidx
  ON workflows (external_reference) WHERE external_reference IS NOT NULL;

CREATE INDEX workflows_status_created_idx
  ON workflows (status, created_at, workflow_id);

CREATE TABLE workflow_steps (
  workflow_id text NOT NULL REFERENCES workflows (workflow_id) ON DELETE CASCADE,
  step_id text NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  dependencies text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('PENDING', 'WAITING_RETRY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  mission_id text REFERENCES missions (mission_id),
  resource_reservation_id text,
  started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  timeout_at timestamptz,
  wait_until timestamptz,
  last_error text,
  lease_owner text,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workflow_id, step_id)
);

CREATE INDEX workflow_steps_runnable_idx
  ON workflow_steps (status, next_attempt_at, lease_expires_at, workflow_id, step_id)
  WHERE status IN ('PENDING', 'WAITING_RETRY', 'RUNNING');

CREATE TABLE workflow_resource_reservations (
  reservation_id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES workflows (workflow_id) ON DELETE CASCADE,
  step_id text NOT NULL,
  resource_id text NOT NULL REFERENCES infrastructure_resources (resource_id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED')),
  released_at timestamptz,
  CHECK (starts_at < ends_at),
  FOREIGN KEY (workflow_id, step_id) REFERENCES workflow_steps (workflow_id, step_id) ON DELETE CASCADE
);

ALTER TABLE workflow_steps
  ADD CONSTRAINT workflow_steps_resource_reservation_fk
  FOREIGN KEY (resource_reservation_id) REFERENCES workflow_resource_reservations (reservation_id);

ALTER TABLE workflow_resource_reservations
  ADD CONSTRAINT workflow_resource_reservations_no_overlap
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (state = 'ACTIVE');
