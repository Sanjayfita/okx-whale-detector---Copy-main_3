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

echo "=== HOST ==="
echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"
if command -v free >/dev/null 2>&1; then free -h; fi
df -h "$PLATFORM_DATA_DIR"

echo "=== CONTAINERS ==="
container_ids=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q)
if [ -n "$container_ids" ]; then
  # shellcheck disable=SC2086
  docker stats --no-stream $container_ids
fi

echo "=== PERSISTENT DATA ==="
du -sh "$PLATFORM_DATA_DIR" 2>/dev/null || true
for file in \
  "$PLATFORM_DATA_DIR/platform/paper-state.json" \
  "$PLATFORM_DATA_DIR/platform/trade-contexts.json" \
  "$PLATFORM_DATA_DIR/platform/settings.json"; do
  if [ -f "$file" ]; then ls -lh "$file"; fi
done
