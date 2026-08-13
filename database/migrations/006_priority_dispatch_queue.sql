CREATE TABLE mission_dispatch_queue (
  mission_id text PRIMARY KEY REFERENCES missions (mission_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISPATCHED', 'CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  enqueued_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  last_error text,
  lease_owner text,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

INSERT INTO mission_dispatch_queue (
  mission_id, status, enqueued_at, next_attempt_at, created_at, updated_at
)
SELECT mission_id, 'PENDING', created_at, now(), created_at, now()
FROM missions
WHERE state = 'QUEUED'
ON CONFLICT (mission_id) DO NOTHING;

CREATE INDEX mission_dispatch_queue_due_idx
  ON mission_dispatch_queue (next_attempt_at, enqueued_at, mission_id)
  WHERE status = 'PENDING';

CREATE INDEX mission_dispatch_queue_lease_idx
  ON mission_dispatch_queue (lease_expires_at, mission_id)
  WHERE status = 'PENDING' AND lease_expires_at IS NOT NULL;
