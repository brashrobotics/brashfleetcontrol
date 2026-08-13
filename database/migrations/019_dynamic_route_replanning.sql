ALTER TABLE traffic_route_plans
  DROP CONSTRAINT traffic_route_plans_mission_id_key;

ALTER TABLE traffic_route_plans
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN supersedes_route_id text REFERENCES traffic_route_plans (route_id),
  ADD COLUMN replan_reason text NOT NULL DEFAULT 'Initial route',
  ADD COLUMN replanned_by text NOT NULL DEFAULT 'system';

ALTER TABLE traffic_route_plans
  ADD CONSTRAINT traffic_route_plans_mission_revision_unique UNIQUE (mission_id, revision);

CREATE UNIQUE INDEX traffic_route_plans_one_current_mission_idx
  ON traffic_route_plans (mission_id)
  WHERE status IN ('ACTIVE', 'SAFETY_HOLD');

CREATE INDEX traffic_route_plans_revision_history_idx
  ON traffic_route_plans (mission_id, revision DESC);
