ALTER TABLE map_topologies
  ADD COLUMN family_id text,
  ADD COLUMN status text,
  ADD COLUMN created_by text,
  ADD COLUMN published_by text,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN retired_by text,
  ADD COLUMN retired_at timestamptz;

UPDATE map_topologies
SET family_id = regexp_replace(map_id, '@[0-9]+$', ''),
    status = 'PUBLISHED',
    created_by = 'system-migration',
    published_by = 'system-migration',
    published_at = created_at;

ALTER TABLE map_topologies
  ALTER COLUMN family_id SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_by SET NOT NULL,
  ADD CONSTRAINT map_topologies_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  ADD CONSTRAINT map_topologies_family_revision_uidx UNIQUE (family_id, revision),
  ADD CONSTRAINT map_topologies_publication_check CHECK (
    (status = 'DRAFT' AND published_at IS NULL AND retired_at IS NULL)
    OR (status = 'PUBLISHED' AND published_at IS NOT NULL AND retired_at IS NULL)
    OR (status = 'RETIRED' AND published_at IS NOT NULL AND retired_at IS NOT NULL)
  );

CREATE INDEX map_topologies_family_status_idx
  ON map_topologies (family_id, status, revision);

CREATE TABLE infrastructure_resources (
  resource_id text PRIMARY KEY,
  map_id text NOT NULL REFERENCES map_topologies (map_id),
  display_name text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('DOOR', 'ELEVATOR', 'CHARGER', 'DOCK', 'WORKCELL')),
  status text NOT NULL CHECK (status IN ('AVAILABLE', 'UNAVAILABLE', 'MAINTENANCE')),
  reservation_policy text NOT NULL CHECK (reservation_policy IN ('TRANSIT_EXCLUSIVE', 'SERVICE_EXCLUSIVE')),
  edge_id text,
  node_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  status_reason text,
  CHECK ((edge_id IS NOT NULL)::integer + (node_id IS NOT NULL)::integer = 1)
);

CREATE INDEX infrastructure_resources_map_status_idx
  ON infrastructure_resources (map_id, status, resource_type, resource_id);

ALTER TABLE traffic_reservations
  DROP CONSTRAINT traffic_reservations_resource_type_check;

ALTER TABLE traffic_reservations
  ADD CONSTRAINT traffic_reservations_resource_type_check
  CHECK (resource_type IN ('EDGE', 'NODE', 'INFRASTRUCTURE'));

