#!/usr/bin/env bash
set -euo pipefail

backup="${1:?usage: ALLOW_DR_RESTORE=true DR_DATABASE_URL=... DR_DATABASE_SCHEMA=... scripts/restore-drill.sh backup.dump}"
: "${DR_DATABASE_URL:?DR_DATABASE_URL must point to an isolated drill database}"
: "${DR_DATABASE_SCHEMA:?DR_DATABASE_SCHEMA is required}"

for command_name in pg_restore psql; do
  command -v "$command_name" >/dev/null || { echo "Required command is missing: $command_name" >&2; exit 127; }
done

if [[ "${ALLOW_DR_RESTORE:-false}" != "true" ]]; then
  echo "Refusing restore without ALLOW_DR_RESTORE=true." >&2
  exit 2
fi
if [[ ! "$DR_DATABASE_SCHEMA" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "DR_DATABASE_SCHEMA must be a safe lowercase PostgreSQL identifier." >&2
  exit 2
fi

"$(dirname "$0")/verify-backup.sh" "$backup"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname="$DR_DATABASE_URL" "$backup"

migration_count="$(psql "$DR_DATABASE_URL" --no-psqlrc --tuples-only --no-align \
  --command="SELECT count(*) FROM \"${DR_DATABASE_SCHEMA}\".fleet_schema_migrations")"
site_count="$(psql "$DR_DATABASE_URL" --no-psqlrc --tuples-only --no-align \
  --command="SELECT count(*) FROM \"${DR_DATABASE_SCHEMA}\".fleet_site_binding")"

test "$migration_count" -gt 0 || { echo "Restored migration ledger is empty." >&2; exit 3; }
test "$site_count" -eq 1 || { echo "Restored site binding is invalid." >&2; exit 3; }
echo "Restore drill verified: migrations=$migration_count site_bindings=$site_count"
