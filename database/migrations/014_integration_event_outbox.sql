CREATE TABLE integration_event_outbox (
  event_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DELIVERED', 'DEAD_LETTER')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  occurred_at timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  response_status integer,
  lease_owner text,
  lease_expires_at timestamptz
);

CREATE INDEX integration_event_outbox_due_idx
  ON integration_event_outbox (next_attempt_at, occurred_at, event_id)
  WHERE status = 'PENDING';

CREATE INDEX integration_event_outbox_aggregate_idx
  ON integration_event_outbox (aggregate_type, aggregate_id, occurred_at DESC);
