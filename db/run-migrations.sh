#!/bin/sh
set -eu

PGHOST="${PGHOST:-database}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-research}"

for migration in /db/migrations/*.sql; do
  echo "Applying ${migration}"
  psql \
    -h "$PGHOST" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    -v ON_ERROR_STOP=1 \
    -f "${migration}"
done
