#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <label>" >&2
  echo "Example labels: baseline, after-container-kill, after-reboot" >&2
  exit 1
fi

LABEL="$1"
case "$LABEL" in
  *[!A-Za-z0-9._-]*|'')
    echo "Evidence label may contain only letters, numbers, dot, underscore, and hyphen" >&2
    exit 1
    ;;
esac

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_DATA_DIR:?PLATFORM_DATA_DIR is required}"
EVIDENCE_ROOT="${ACCEPTANCE_EVIDENCE_DIR:-/opt/okx-whale-detector/acceptance}"
case "$EVIDENCE_ROOT" in
  /|'')
    echo "Unsafe ACCEPTANCE_EVIDENCE_DIR: $EVIDENCE_ROOT" >&2
    exit 1
    ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DESTINATION="$EVIDENCE_ROOT/$STAMP-$LABEL"
umask 077
mkdir -p "$DESTINATION"
chmod 700 "$DESTINATION"

platform_id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q platform 2>/dev/null || true)"
database_id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q database 2>/dev/null || true)"

{
  echo "captured_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "label=$LABEL"
  echo "hostname=$(hostname)"
  echo "os=$(uname -srmo)"
  echo "docker=$(docker --version)"
  echo "compose=$(docker compose version --short)"
  echo "git_commit=$(git rev-parse HEAD)"
  echo "git_branch=$(git branch --show-current)"
  echo "configuration_version=${APP_CONFIGURATION_VERSION:-unknown}"
  if [ -n "$platform_id" ]; then
    echo "platform_container_id=$platform_id"
    echo "platform_image=$(docker inspect -f '{{.Config.Image}}' "$platform_id")"
    echo "platform_started_at=$(docker inspect -f '{{.State.StartedAt}}' "$platform_id")"
    echo "platform_restart_count=$(docker inspect -f '{{.RestartCount}}' "$platform_id")"
  fi
  if [ -n "$database_id" ]; then
    echo "database_container_id=$database_id"
    echo "database_image=$(docker inspect -f '{{.Config.Image}}' "$database_id")"
    echo "database_started_at=$(docker inspect -f '{{.State.StartedAt}}' "$database_id")"
  fi
} > "$DESTINATION/manifest.txt"

git status --short --branch > "$DESTINATION/git-status.txt"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --all \
  > "$DESTINATION/compose-ps.txt"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs \
  --no-color --timestamps --tail=300 platform > "$DESTINATION/platform-logs.txt" 2>&1 || true

if curl -fsS --max-time 10 "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health" \
  > "$DESTINATION/health.json"; then
  if ! grep -q '"liveExecutionAllowed":false' "$DESTINATION/health.json"; then
    echo "Captured health did not prove that live execution is disabled" >&2
    exit 1
  fi
else
  echo '{"captureError":"health endpoint unavailable"}' > "$DESTINATION/health.json"
fi

if ! curl -fsS --max-time 10 "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/snapshot" \
  > "$DESTINATION/account-snapshot.json"; then
  echo '{"captureError":"snapshot endpoint unavailable"}' > "$DESTINATION/account-snapshot.json"
fi

if [ -n "$platform_id$database_id" ]; then
  # shellcheck disable=SC2086
  docker stats --no-stream $platform_id $database_id \
    > "$DESTINATION/container-stats.txt" 2>&1 || true
fi
df -Pk "$PLATFORM_DATA_DIR" > "$DESTINATION/disk.txt"
du -sk "$PLATFORM_DATA_DIR" > "$DESTINATION/platform-data-size.txt"

(
  cd "$PLATFORM_DATA_DIR/platform"
  for file in paper-state.json trade-contexts.json settings.json \
    .paper-account-initialized; do
    if [ -f "$file" ]; then sha256sum "$file"; fi
  done
) > "$DESTINATION/state-checksums.sha256"

(
  cd "$DESTINATION"
  for file in *; do
    if [ -f "$file" ] && [ "$file" != "evidence-checksums.sha256" ]; then
      sha256sum "$file"
    fi
  done > evidence-checksums.sha256
)

echo "Acceptance evidence captured: $DESTINATION"
echo "No environment file or container environment was recorded."
