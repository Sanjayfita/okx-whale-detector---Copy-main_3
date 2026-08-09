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

SAMPLE_COUNT="${RESOURCE_SAMPLE_COUNT:-1}"
SAMPLE_INTERVAL_SECONDS="${RESOURCE_SAMPLE_INTERVAL_SECONDS:-60}"
case "$SAMPLE_COUNT:$SAMPLE_INTERVAL_SECONDS" in
  *[!0-9:]*|0:*|*:)
    echo "RESOURCE_SAMPLE_COUNT must be positive and RESOURCE_SAMPLE_INTERVAL_SECONDS must be non-negative" >&2
    exit 1
    ;;
esac

echo "=== HOST ==="
echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"
if command -v free >/dev/null 2>&1; then free -h; fi
df -h "$PLATFORM_DATA_DIR"

sample=1
while [ "$sample" -le "$SAMPLE_COUNT" ]; do
  echo "=== SAMPLE $sample/$SAMPLE_COUNT ==="
  echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  uptime || true

  echo "--- CONTAINERS ---"
  container_ids=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q)
  if [ -n "$container_ids" ]; then
    # Net I/O and block I/O are included alongside CPU and memory.
    # shellcheck disable=SC2086
    docker stats --no-stream $container_ids
  fi

  echo "--- PERSISTENT DATA ---"
  du -sk "$PLATFORM_DATA_DIR" 2>/dev/null || true
  for file in \
    "$PLATFORM_DATA_DIR/platform/paper-state.json" \
    "$PLATFORM_DATA_DIR/platform/trade-contexts.json" \
    "$PLATFORM_DATA_DIR/platform/settings.json"; do
    if [ -f "$file" ]; then ls -ln "$file"; fi
  done

  echo "--- POSTGRESQL ---"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
    psql -U "${POSTGRES_USER:-paperapp}" -d "${POSTGRES_DB:-research}" -At \
    -c "SELECT pg_database_size(current_database())" 2>/dev/null || true

  echo "--- DOCKER STORAGE ---"
  docker system df || true

  if [ "$sample" -lt "$SAMPLE_COUNT" ]; then
    sleep "$SAMPLE_INTERVAL_SECONDS"
  fi
  sample=$((sample + 1))
done
