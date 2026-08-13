CREATE TABLE robot_operator_controls (
  robot_id text PRIMARY KEY REFERENCES robots(robot_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('QUARANTINED', 'CLEARED')),
  reason text NOT NULL,
  quarantined_by text NOT NULL,
  quarantined_at timestamptz NOT NULL,
  cleared_by text,
  cleared_at timestamptz,
  inspection_reference text,
  CHECK (
    (status = 'QUARANTINED' AND cleared_by IS NULL AND cleared_at IS NULL AND inspection_reference IS NULL)
    OR
    (status = 'CLEARED' AND cleared_by IS NOT NULL AND cleared_at IS NOT NULL AND inspection_reference IS NOT NULL)
  )
);

CREATE INDEX robot_operator_controls_active_idx
  ON robot_operator_controls (quarantined_at DESC, robot_id)
  WHERE status = 'QUARANTINED';
