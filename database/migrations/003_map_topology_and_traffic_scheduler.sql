CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE mission_events
  DROP CONSTRAINT mission_events_event_type_check;

ALTER TABLE mission_events
  ADD CONSTRAINT mission_events_event_type_check CHECK (
    event_type IN (
      'MISSION_QUEUED', 'ASSIGNMENT_NOT_FOUND', 'MISSION_ASSIGNED',
      'ROUTE_RESERVED', 'ROUTE_DELAYED', 'ROUTE_RELEASED',
      'COMMAND_DELIVERY_FAILED', 'COMMAND_DISPATCHED', 'COMMAND_REJECTED',
      'MISSION_EXECUTING', 'MISSION_COMPLETED', 'MISSION_FAILED', 'MISSION_CANCELLED'
    )
  );

CREATE TABLE map_topologies (
  map_id text PRIMARY KEY,
  display_name text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  topology jsonb NOT NULL CHECK (jsonb_typeof(topology) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE traffic_route_plans (
  route_id text PRIMARY KEY,
  mission_id text NOT NULL UNIQUE REFERENCES missions (mission_id) ON DELETE CASCADE,
  robot_id text NOT NULL REFERENCES robots (robot_id),
  map_id text NOT NULL REFERENCES map_topologies (map_id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED')),
  origin_node_id text NOT NULL,
  pickup_node_id text NOT NULL,
  dropoff_node_id text NOT NULL,
  requested_start_at timestamptz NOT NULL,
  scheduled_start_at timestamptz NOT NULL,
  expected_arrival_at timestamptz NOT NULL,
  total_distance_meters double precision NOT NULL CHECK (total_distance_meters >= 0),
  total_wait_seconds double precision NOT NULL CHECK (total_wait_seconds >= 0),
  segments jsonb NOT NULL CHECK (jsonb_typeof(segments) = 'array'),
  planned_at timestamptz NOT NULL,
  released_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE INDEX traffic_route_plans_map_schedule_idx
  ON traffic_route_plans (map_id, status, scheduled_start_at, route_id);

CREATE TABLE traffic_reservations (
  reservation_id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES traffic_route_plans (route_id) ON DELETE CASCADE,
  mission_id text NOT NULL REFERENCES missions (mission_id) ON DELETE CASCADE,
  robot_id text NOT NULL REFERENCES robots (robot_id),
  map_id text NOT NULL REFERENCES map_topologies (map_id),
  resource_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('EDGE', 'NODE')),
  sequence integer NOT NULL CHECK (sequence > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED')),
  released_at timestamptz,
  CHECK (starts_at < ends_at),
  UNIQUE (route_id, sequence)
);

CREATE INDEX traffic_reservations_active_timeline_idx
  ON traffic_reservations (map_id, starts_at, ends_at, resource_id)
  WHERE state = 'ACTIVE';

ALTER TABLE traffic_reservations
  ADD CONSTRAINT traffic_reservations_no_active_overlap
  EXCLUDE USING gist (
    map_id WITH =,
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (state = 'ACTIVE');
