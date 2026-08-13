CREATE TABLE fleet_leader_leases (
  resource_name text PRIMARY KEY,
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  acquired_at timestamptz NOT NULL,
  renewed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX fleet_leader_leases_expiry_idx ON fleet_leader_leases (expires_at);
