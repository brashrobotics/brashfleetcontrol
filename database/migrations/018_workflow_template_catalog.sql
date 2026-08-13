CREATE TABLE workflow_templates (
  template_id text PRIMARY KEY,
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  description text NOT NULL,
  parameter_schema jsonb NOT NULL CHECK (jsonb_typeof(parameter_schema) = 'array'),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array'),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  operator_id text NOT NULL,
  created_at timestamptz NOT NULL,
  published_by text,
  published_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  UNIQUE (template_key, version)
);

CREATE UNIQUE INDEX workflow_templates_one_published_key_idx
  ON workflow_templates (template_key) WHERE status = 'PUBLISHED';

CREATE INDEX workflow_templates_catalog_idx
  ON workflow_templates (template_key, version DESC);
