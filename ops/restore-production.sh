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
if find "$SOURCE" -maxdepth 1 -type f -name '.env*' | grep -q .; then
  echo "Backup contains an environment/secrets file; refusing restore" >&2
  exit 1
fi
if [ -f "$SOURCE/checksums.sha256" ]; then
  if [ ! -f "$SOURCE/manifest.txt" ] ||
     ! grep -q '^backup_format_version=2$' "$SOURCE/manifest.txt" ||
     ! grep -Eq ' [* ]paper-state.json$' "$SOURCE/checksums.sha256" ||
     ! grep -Eq ' [* ]manifest.txt$' "$SOURCE/checksums.sha256"; then
    echo "Backup v2 manifest/checksum inventory is incomplete" >&2
    exit 1
  fi
  (
    cd "$SOURCE"
    sha256sum -c checksums.sha256
  )
elif [ "${ALLOW_LEGACY_BACKUP:-0}" != "1" ]; then
  echo "Backup has no checksums.sha256. Inspect it, then set ALLOW_LEGACY_BACKUP=1 only for a trusted legacy backup." >&2
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

if [ "${RESTORE_RESEARCH_DB:-0}" = "1" ] && [ ! -f "$SOURCE/research.dump" ]; then
  echo "RESTORE_RESEARCH_DB=1 but research.dump is missing" >&2
  exit 1
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

if [ "${SKIP_PRE_RESTORE_BACKUP:-0}" != "1" ] &&
   [ -f "$PLATFORM_DATA_DIR/platform/paper-state.json" ]; then
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup-production.sh
fi

if [ "${SKIP_CONTAINER_CONTROL:-0}" != "1" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop platform
fi

mkdir -p "$PLATFORM_DATA_DIR/platform"
restore_file() {
  source_file="$1"
  target_file="$2"
  if [ ! -f "$source_file" ]; then
    rm -f "$target_file"
    return
  fi
  temporary_file="$target_file.restore.tmp"
  cp "$source_file" "$temporary_file"
  chown "$PLATFORM_UID:$PLATFORM_GID" "$temporary_file" 2>/dev/null || true
  mv "$temporary_file" "$target_file"
}

restore_file "$SOURCE/paper-state.json" "$PLATFORM_DATA_DIR/platform/paper-state.json"
restore_file "$SOURCE/trade-contexts.json" "$PLATFORM_DATA_DIR/platform/trade-contexts.json"
restore_file "$SOURCE/settings.json" "$PLATFORM_DATA_DIR/platform/settings.json"
restore_file "$SOURCE/paper-account-initialized.txt" "$PLATFORM_DATA_DIR/platform/.paper-account-initialized"
if [ ! -f "$PLATFORM_DATA_DIR/platform/.paper-account-initialized" ]; then
  umask 077
  echo "restored_legacy_backup_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$PLATFORM_DATA_DIR/platform/.paper-account-initialized"
  chown "$PLATFORM_UID:$PLATFORM_GID" \
    "$PLATFORM_DATA_DIR/platform/.paper-account-initialized" 2>/dev/null || true
fi

if [ "${RESTORE_RESEARCH_DB:-0}" = "1" ]; then
  if [ "${SKIP_CONTAINER_CONTROL:-0}" = "1" ]; then
    echo "Database restore requires container control" >&2
    exit 1
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d database
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
    pg_restore --clean --if-exists --no-owner --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < "$SOURCE/research.dump"
fi

if [ "${SKIP_CONTAINER_CONTROL:-0}" != "1" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d database
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrations
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d platform

  attempts=0
  until ENV_FILE="$ENV_FILE" sh ops/check-production-health.sh >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "Platform failed the production health gate after restore" >&2
      exit 1
    fi
    sleep 2
  done
  ENV_FILE="$ENV_FILE" sh ops/check-production-health.sh
fi

echo "Paper account restore completed from: $SOURCE"
echo "Compare the restored account snapshot and database evidence before marking acceptance PASS."
