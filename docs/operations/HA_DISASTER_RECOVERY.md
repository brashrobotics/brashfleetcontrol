# High Availability and Disaster Recovery

BRASH Fleet Control supports active-active API processes. Durable workers already
claim individual rows with expiring leases and idempotency keys. A separate,
site-scoped control-plane lease identifies the single process permitted to run
future singleton operations.

## Leader fencing

Each successful takeover increments a PostgreSQL `fencing_token`. A singleton
operation must validate both its owner ID and token immediately before changing
an external resource. An expired process cannot release or validate the lease
owned by its successor. `/api/v1/ready` reports database reachability and the
local process's observed leadership state; follower processes remain ready to
serve APIs and distributed workers.

Run at least two Fleet Server replicas behind a health-aware load balancer. Keep
`FLEET_LEADER_POLL_MS` comfortably below `FLEET_LEADER_LEASE_MS`; the defaults
are 5 and 15 seconds. Use PostgreSQL primary/standby replication managed by the
platform, and never place two writable database primaries behind the same Fleet
site.

## Backup

Define RPO and RTO with the factory operator. A practical initial target is a
15-minute RPO and a 60-minute RTO, but neither is guaranteed until measured in
the deployment environment. Install matching PostgreSQL client tools
(`pg_dump`, `pg_restore`, and `psql`) on the operations runner, then schedule:

```bash
export DATABASE_URL='postgresql://...'
export DATABASE_SCHEMA='brash_plant_a'
export BACKUP_DIRECTORY='/srv/brash-backups'
scripts/backup-postgres.sh
```

The script creates a PostgreSQL custom-format dump, verifies its catalog, and
writes a SHA-256 sidecar. Encrypt backups at rest, replicate them to a separate
failure domain, restrict access, and test retention alarms.

## Verification and restore drill

Run checksum/catalog verification after every copy:

```bash
scripts/verify-backup.sh /srv/brash-backups/brash-fleet-brash_plant_a-....dump
```

At least monthly, restore into a dedicated empty drill database. Never point
`DR_DATABASE_URL` at production. The explicit guard prevents accidental use:

```bash
export ALLOW_DR_RESTORE=true
export DR_DATABASE_URL='postgresql://.../brash_fleet_drill'
export DR_DATABASE_SCHEMA='brash_plant_a'
scripts/restore-drill.sh /srv/brash-backups/brash-fleet-brash_plant_a-....dump
```

Record dump timestamp, checksum, restore duration, migration count, site
binding, and an authenticated `/api/v1/ready` smoke test. The measured dump age
and restore duration are the demonstrated RPO and RTO.

## Database failover

1. Stop automated promotion if both primary candidates are writable.
2. Confirm the old primary is fenced at the database/infrastructure layer.
3. Promote the most current standby and update `DATABASE_URL` through the secret
   manager.
4. Restart Fleet Server replicas; migration advisory locking makes concurrent
   startup safe.
5. Confirm `/api/v1/ready`, one live fencing owner, worker progress, command
   outbox delivery, and zero cross-site binding errors.
6. Reconcile missions that were active at the failover boundary before lifting
   any operator safety holds.

Database replication and backups protect state, not physical safety. Robot and
PLC emergency-stop behavior must remain independent of Fleet Server availability.
