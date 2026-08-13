#!/usr/bin/env bash
set -euo pipefail

backup="${1:?usage: scripts/verify-backup.sh /path/to/backup.dump}"
checksum="${backup}.sha256"

for command_name in pg_restore sha256sum; do
  command -v "$command_name" >/dev/null || { echo "Required command is missing: $command_name" >&2; exit 127; }
done

test -r "$backup" || { echo "Backup is not readable: $backup" >&2; exit 2; }
test -r "$checksum" || { echo "Checksum is not readable: $checksum" >&2; exit 2; }

(cd "$(dirname "$backup")" && sha256sum --check "$(basename "$checksum")")
contents="$(pg_restore --list "$backup")"
grep -q "fleet_schema_migrations" <<<"$contents" || { echo "Migration ledger is missing." >&2; exit 3; }
grep -q "fleet_site_binding" <<<"$contents" || { echo "Site binding is missing." >&2; exit 3; }

echo "Backup checksum and catalog verified: $backup"
