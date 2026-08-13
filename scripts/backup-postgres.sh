#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the source PostgreSQL database}"
: "${DATABASE_SCHEMA:?DATABASE_SCHEMA is required}"
: "${BACKUP_DIRECTORY:?BACKUP_DIRECTORY is required}"

for command_name in pg_dump pg_restore sha256sum; do
  command -v "$command_name" >/dev/null || { echo "Required command is missing: $command_name" >&2; exit 127; }
done

if [[ ! "$DATABASE_SCHEMA" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "DATABASE_SCHEMA must be a safe lowercase PostgreSQL identifier." >&2
  exit 2
fi

mkdir -p "$BACKUP_DIRECTORY"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$BACKUP_DIRECTORY/brash-fleet-${DATABASE_SCHEMA}-${timestamp}.dump"
temporary="${backup}.partial"

cleanup() { rm -f "$temporary"; }
trap cleanup EXIT

pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  --schema="$DATABASE_SCHEMA" --file="$temporary" "$DATABASE_URL"
pg_restore --list "$temporary" >/dev/null
mv "$temporary" "$backup"
sha256sum "$backup" >"${backup}.sha256"
trap - EXIT

echo "$backup"
