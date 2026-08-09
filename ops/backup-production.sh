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
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DESTINATION="$BACKUP_DIR/$STAMP"

case "$BACKUP_DIR" in
  /|"")
    echo "Unsafe BACKUP_DIR: $BACKUP_DIR" >&2
    exit 1
    ;;
esac

if [ ! -f "$PLATFORM_DATA_DIR/platform/paper-state.json" ]; then
  echo "Refusing to create a production backup without paper-state.json" >&2
  exit 1
fi

command -v sha256sum >/dev/null 2>&1 || {
  echo "sha256sum is required for verifiable backups" >&2
  exit 1
}

# Prefer the identity reported by the running platform over stale values left in
# the environment file after a prior deploy command exits. The container
# environment is a fallback for a temporarily unavailable health endpoint.
MANIFEST_IDENTITY_SOURCE="environment_fallback"
if command -v curl >/dev/null 2>&1 && \
   runtime_health="$(curl -fsS --max-time 5 "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health" 2>/dev/null)"; then
  runtime_git_commit="$(printf '%s' "$runtime_health" | sed -n 's/.*"gitCommit":"\([^"]*\)".*/\1/p')"
  runtime_image_version="$(printf '%s' "$runtime_health" | sed -n 's/.*"imageVersion":"\([^"]*\)".*/\1/p')"
  runtime_configuration_version="$(printf '%s' "$runtime_health" | sed -n 's/.*"configurationVersion":"\([^"]*\)".*/\1/p')"
  if [ -n "$runtime_git_commit" ] && [ -n "$runtime_image_version" ]; then
    APP_GIT_COMMIT="$runtime_git_commit"
    APP_IMAGE_VERSION="$runtime_image_version"
    APP_CONFIGURATION_VERSION="${runtime_configuration_version:-unknown}"
    MANIFEST_IDENTITY_SOURCE="runtime_health"
  fi
fi

if [ "$MANIFEST_IDENTITY_SOURCE" = "environment_fallback" ] && \
   command -v docker >/dev/null 2>&1; then
  platform_container_id="$(
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -a -q platform 2>/dev/null || true
  )"
  if [ -n "$platform_container_id" ]; then
    container_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$platform_container_id" 2>/dev/null || true)"
    container_git_commit="$(printf '%s\n' "$container_env" | sed -n 's/^APP_GIT_COMMIT=//p' | tail -n 1)"
    container_image_version="$(printf '%s\n' "$container_env" | sed -n 's/^APP_IMAGE_VERSION=//p' | tail -n 1)"
    container_configuration_version="$(printf '%s\n' "$container_env" | sed -n 's/^APP_CONFIGURATION_VERSION=//p' | tail -n 1)"
    if [ -n "$container_git_commit" ] && [ -n "$container_image_version" ]; then
      APP_GIT_COMMIT="$container_git_commit"
      APP_IMAGE_VERSION="$container_image_version"
      APP_CONFIGURATION_VERSION="${container_configuration_version:-unknown}"
      MANIFEST_IDENTITY_SOURCE="running_platform_container"
    fi
  fi
fi

umask 077
mkdir -p "$BACKUP_DIR"
if [ -e "$DESTINATION" ]; then
  echo "Backup destination already exists: $DESTINATION" >&2
  exit 1
fi
WORKING_DESTINATION="$(mktemp -d "$BACKUP_DIR/.incomplete-$STAMP.XXXXXX")"
trap 'rm -rf "$WORKING_DESTINATION"' EXIT INT TERM

copy_if_present() {
  source_file="$1"
  target_name="$2"
  if [ -f "$source_file" ]; then
    cp "$source_file" "$WORKING_DESTINATION/$target_name"
  fi
}

copy_if_present "$PLATFORM_DATA_DIR/platform/paper-state.json" paper-state.json
copy_if_present "$PLATFORM_DATA_DIR/platform/trade-contexts.json" trade-contexts.json
copy_if_present "$PLATFORM_DATA_DIR/platform/settings.json" settings.json
copy_if_present "$PLATFORM_DATA_DIR/platform/.paper-account-initialized" paper-account-initialized.txt

if [ "${SKIP_DATABASE_BACKUP:-0}" != "1" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
    > "$WORKING_DESTINATION/research.dump.tmp"
  if [ ! -s "$WORKING_DESTINATION/research.dump.tmp" ]; then
    echo "PostgreSQL backup is empty" >&2
    exit 1
  fi
  mv "$WORKING_DESTINATION/research.dump.tmp" "$WORKING_DESTINATION/research.dump"
fi

cat > "$WORKING_DESTINATION/manifest.txt" <<EOF
backup_format_version=2
created_at_utc=$STAMP
identity_source=$MANIFEST_IDENTITY_SOURCE
app_git_commit=${APP_GIT_COMMIT:-unknown}
app_image_version=${APP_IMAGE_VERSION:-unknown}
configuration_version=${APP_CONFIGURATION_VERSION:-unknown}
paper_state_present=$(test -f "$WORKING_DESTINATION/paper-state.json" && echo yes || echo no)
trade_contexts_present=$(test -f "$WORKING_DESTINATION/trade-contexts.json" && echo yes || echo no)
settings_present=$(test -f "$WORKING_DESTINATION/settings.json" && echo yes || echo no)
database_dump_present=$(test -f "$WORKING_DESTINATION/research.dump" && echo yes || echo no)
EOF

(
  cd "$WORKING_DESTINATION"
  for file in paper-state.json trade-contexts.json settings.json \
    paper-account-initialized.txt research.dump manifest.txt; do
    if [ -f "$file" ]; then sha256sum "$file"; fi
  done > checksums.sha256
)
(
  cd "$WORKING_DESTINATION"
  sha256sum -c checksums.sha256 >/dev/null
)
mv "$WORKING_DESTINATION" "$DESTINATION"
trap - EXIT INT TERM

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \
  -name '????????T??????Z' -mtime "+$BACKUP_RETENTION_DAYS" -exec rm -rf {} +

echo "Production backup created: $DESTINATION"
echo "Backup checksums: $DESTINATION/checksums.sha256"
