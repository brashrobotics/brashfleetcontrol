CREATE TABLE alarms (
  alarm_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint text NOT NULL,
  alarm_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  status text NOT NULL CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  title text NOT NULL,
  message text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('ROBOT', 'MISSION', 'TRAFFIC', 'SYSTEM')),
  source_id text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_occurred_at timestamptz NOT NULL,
  last_occurred_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledgement_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX alarms_active_fingerprint_uidx
  ON alarms (fingerprint)
  WHERE status <> 'RESOLVED';

CREATE INDEX alarms_active_priority_idx
  ON alarms (severity, last_occurred_at DESC, alarm_id DESC)
  WHERE status <> 'RESOLVED';
