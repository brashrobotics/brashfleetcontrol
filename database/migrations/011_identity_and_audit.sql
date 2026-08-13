CREATE TABLE audit_events (
  audit_event_id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor_id text NOT NULL,
  actor_display_name text NOT NULL,
  actor_role text CHECK (actor_role IS NULL OR actor_role IN ('VIEWER', 'OPERATOR', 'DISPATCHER', 'FLEET_ADMIN', 'INTEGRATION')),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ATTEMPTED', 'SUCCEEDED', 'DENIED', 'FAILED')),
  correlation_id text NOT NULL,
  request_method text NOT NULL,
  request_path text NOT NULL,
  site_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_events_occurred_idx ON audit_events (occurred_at DESC, audit_event_id DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id);

CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_reject_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER audit_events_reject_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
