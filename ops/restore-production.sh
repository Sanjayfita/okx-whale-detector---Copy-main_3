#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup-directory>" >&2
  exit 1
fi

SOURCE="$1"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

if [ ! -d "$SOURCE" ]; then
  echo "Backup directory does not exist: $SOURCE" >&2
  exit 1
fi
if [ ! -f "$SOURCE/paper-state.json" ]; then
  echo "Backup does not contain paper-state.json" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_DATA_DIR:?PLATFORM_DATA_DIR is required}"
: "${PLATFORM_UID:=1000}"
: "${PLATFORM_GID:=1000}"
: "${POSTGRES_USER:=paperapp}"
: "${POSTGRES_DB:=research}"

if [ -f "$SOURCE/SHA256SUMS" ]; then
  if ! command -v sha256sum >/dev/null 2>&1; then
    echo "sha256sum is required to verify this backup" >&2
    exit 1
  fi
  (cd "$SOURCE" && sha256sum -c SHA256SUMS)
else
  echo "WARNING: backup has no SHA256SUMS; integrity cannot be cryptographically verified" >&2
fi

validate_json() {
  target="$1"
  if command -v node >/dev/null 2>&1; then
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$target"
    return
  fi
  docker run --rm -v "$SOURCE:/restore:ro" node:24-bookworm-slim \
    node -e "JSON.parse(require('fs').readFileSync('/restore/$(basename "$target")', 'utf8'))"
}

validate_json "$SOURCE/paper-state.json"
if [ -f "$SOURCE/trade-contexts.json" ]; then validate_json "$SOURCE/trade-contexts.json"; fi
if [ -f "$SOURCE/settings.json" ]; then validate_json "$SOURCE/settings.json"; fi

if [ "${SKIP_CONTAINER_CONTROL:-0}" != "1" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop platform
fi

mkdir -p "$PLATFORM_DATA_DIR/platform"
restore_file() {
  source_file="$1"
  target_file="$2"
  if [ ! -f "$source_file" ]; then return; fi
  temporary_file="$target_file.restore.tmp"
  cp "$source_file" "$temporary_file"
  chown "$PLATFORM_UID:$PLATFORM_GID" "$temporary_file" 2>/dev/null || true
  mv "$temporary_file" "$target_file"
}

restore_file "$SOURCE/paper-state.json" "$PLATFORM_DATA_DIR/platform/paper-state.json"
restore_file "$SOURCE/trade-contexts.json" "$PLATFORM_DATA_DIR/platform/trade-contexts.json"
restore_file "$SOURCE/settings.json" "$PLATFORM_DATA_DIR/platform/settings.json"

if [ "${RESTORE_RESEARCH_DB:-0}" = "1" ]; then
  if [ ! -f "$SOURCE/research.dump" ]; then
    echo "RESTORE_RESEARCH_DB=1 but research.dump is missing" >&2
    exit 1
  fi
  if [ "${SKIP_CONTAINER_CONTROL:-0}" = "1" ]; then
    echo "Database restore requires container control" >&2
    exit 1
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d database
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
    pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < "$SOURCE/research.dump"
fi

if [ "${SKIP_CONTAINER_CONTROL:-0}" != "1" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d database
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrations
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d platform

  attempts=0
  health_body=""
  until health_body="$(curl -fsS "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health" 2>/dev/null)" && \
    printf '%s' "$health_body" | grep -q '"application":"RUNNING"'; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "Platform did not reach application=RUNNING after restore" >&2
      if [ -n "$health_body" ]; then
        echo "Last health response: $health_body" >&2
      fi
      exit 1
    fi
    sleep 2
  done
  echo "Restore procedure completed and platform reached application=RUNNING from: $SOURCE"
else
  echo "Restore file copy completed in test mode from: $SOURCE"
fi
