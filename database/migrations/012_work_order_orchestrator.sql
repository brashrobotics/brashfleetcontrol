ALTER TABLE missions
  ADD COLUMN preferred_robot_id text REFERENCES robots (robot_id);

CREATE TABLE work_orders (
  work_order_id text PRIMARY KEY,
  external_reference text,
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  status text NOT NULL CHECK (status IN ('PENDING', 'ALLOCATED', 'RUNNING', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  selected_robot_id text REFERENCES robots (robot_id),
  workflow_id text REFERENCES workflows (workflow_id),
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(candidates) = 'array'),
  allocation_attempt_count integer NOT NULL DEFAULT 0 CHECK (allocation_attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  failure_reason text,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE UNIQUE INDEX work_orders_external_reference_uidx
  ON work_orders (external_reference) WHERE external_reference IS NOT NULL;

CREATE INDEX work_orders_pending_idx
  ON work_orders (status, next_attempt_at, lease_expires_at, work_order_id)
  WHERE status = 'PENDING';

CREATE INDEX work_orders_workflow_idx
  ON work_orders (workflow_id) WHERE workflow_id IS NOT NULL;
