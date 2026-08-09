#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_DATA_DIR:?PLATFORM_DATA_DIR is required}"
: "${POSTGRES_USER:=paperapp}"
: "${POSTGRES_DB:=research}"
BACKUP_DIR="${BACKUP_DIR:-/opt/okx-whale-detector/backups}"

echo "=== SAMPLE ==="
echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "git_commit=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "=== HOST ==="
echo "cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"
if command -v uptime >/dev/null 2>&1; then uptime; fi
if command -v free >/dev/null 2>&1; then free -h; fi
df -h "$PLATFORM_DATA_DIR"

echo "=== CONTAINERS ==="
container_ids=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q)
if [ -n "$container_ids" ]; then
  # Includes per-container CPU, memory, network I/O, block I/O and process count.
  # shellcheck disable=SC2086
  docker stats --no-stream $container_ids
else
  echo "No running Compose containers."
fi

echo "=== DOCKER STORAGE ==="
docker system df || true

echo "=== PLATFORM PERSISTENT DATA ==="
du -sh "$PLATFORM_DATA_DIR" 2>/dev/null || true
for file in \
  "$PLATFORM_DATA_DIR/platform/paper-state.json" \
  "$PLATFORM_DATA_DIR/platform/trade-contexts.json" \
  "$PLATFORM_DATA_DIR/platform/settings.json"; do
  if [ -f "$file" ]; then ls -lh "$file"; fi
done

if [ -d "$BACKUP_DIR" ]; then
  echo "backup_directory=$BACKUP_DIR"
  du -sh "$BACKUP_DIR" 2>/dev/null || true
fi

echo "=== POSTGRESQL STORAGE ==="
database_id="$(
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q database 2>/dev/null || true
)"
if [ -n "$database_id" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
    sh -c 'du -sh /var/lib/postgresql/data 2>/dev/null || true' || true
  database_bytes="$(
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
      'SELECT pg_database_size(current_database());' 2>/dev/null || true
  )"
  if [ -n "$database_bytes" ]; then
    echo "postgres_database_bytes=$database_bytes"
  else
    echo "postgres_database_bytes=unavailable"
  fi
else
  echo "PostgreSQL container is not running; database size unavailable."
fi

echo "Capture repeated samples during normal load and recovery; calculate growth from timestamps rather than inferring it from one sample."
