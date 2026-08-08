#!/bin/sh
set -eu

for migration in /db/migrations/*.sql; do
  echo "Applying ${migration}"
  psql \
    -h database \
    -U postgres \
    -d research \
    -v ON_ERROR_STOP=1 \
    -f "${migration}"
done
