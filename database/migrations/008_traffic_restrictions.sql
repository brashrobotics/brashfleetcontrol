CREATE TABLE traffic_restrictions (
  restriction_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  map_id text NOT NULL REFERENCES map_topologies (map_id),
  resource_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'CLEARED')),
  reason text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  cleared_by text,
  cleared_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX traffic_restrictions_active_uidx
  ON traffic_restrictions (map_id, resource_id) WHERE status = 'ACTIVE';
