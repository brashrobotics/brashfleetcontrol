CREATE TABLE fleet_site_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  site_id text NOT NULL UNIQUE,
  bound_at timestamptz NOT NULL DEFAULT now()
);
