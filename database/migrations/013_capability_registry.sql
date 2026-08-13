ALTER TABLE robots
  ADD COLUMN capability_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(capability_metadata) = 'object');

ALTER TABLE missions
  ADD COLUMN robot_constraints jsonb CHECK (robot_constraints IS NULL OR jsonb_typeof(robot_constraints) = 'object');

CREATE TABLE robot_capability_profiles (
  profile_id text PRIMARY KEY,
  vendor text NOT NULL,
  model text NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  actions jsonb NOT NULL CHECK (jsonb_typeof(actions) = 'array'),
  max_payload_kg numeric NOT NULL CHECK (max_payload_kg >= 0),
  allowed_zones jsonb NOT NULL CHECK (jsonb_typeof(allowed_zones) = 'array'),
  dimensions_meters jsonb NOT NULL CHECK (jsonb_typeof(dimensions_meters) = 'object'),
  supported_floor_types jsonb NOT NULL CHECK (jsonb_typeof(supported_floor_types) = 'array'),
  attachments jsonb NOT NULL CHECK (jsonb_typeof(attachments) = 'array'),
  supports_cancellation boolean NOT NULL,
  adapter_protocol_version text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  published_by text,
  published_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  UNIQUE (vendor, model, profile_version)
);

CREATE UNIQUE INDEX robot_capability_profiles_one_published_model_uidx
  ON robot_capability_profiles (vendor, model) WHERE status = 'PUBLISHED';

CREATE INDEX robot_capability_profiles_status_idx
  ON robot_capability_profiles (status, vendor, model, profile_version DESC);
