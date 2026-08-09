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

umask 077
mkdir -p "$DESTINATION"

copy_if_present() {
  source_file="$1"
  target_name="$2"
  if [ -f "$source_file" ]; then
    cp "$source_file" "$DESTINATION/$target_name"
  fi
}

copy_if_present "$PLATFORM_DATA_DIR/platform/paper-state.json" paper-state.json
copy_if_present "$PLATFORM_DATA_DIR/platform/trade-contexts.json" trade-contexts.json
copy_if_present "$PLATFORM_DATA_DIR/platform/settings.json" settings.json

cat > "$DESTINATION/manifest.txt" <<EOF
created_at_utc=$STAMP
app_git_commit=${APP_GIT_COMMIT:-unknown}
app_image_version=${APP_IMAGE_VERSION:-unknown}
configuration_version=${APP_CONFIGURATION_VERSION:-unknown}
paper_state_present=$(test -f "$DESTINATION/paper-state.json" && echo yes || echo no)
trade_contexts_present=$(test -f "$DESTINATION/trade-contexts.json" && echo yes || echo no)
settings_present=$(test -f "$DESTINATION/settings.json" && echo yes || echo no)
EOF

if [ "${SKIP_DATABASE_BACKUP:-0}" != "1" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
    > "$DESTINATION/research.dump"
fi

if ! command -v sha256sum >/dev/null 2>&1; then
  echo "sha256sum is required to create verifiable production backups" >&2
  exit 1
fi
: > "$DESTINATION/SHA256SUMS"
for file in manifest.txt paper-state.json trade-contexts.json settings.json research.dump; do
  if [ -f "$DESTINATION/$file" ]; then
    (cd "$DESTINATION" && sha256sum "$file") >> "$DESTINATION/SHA256SUMS"
  fi
done

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \
  -mtime "+$BACKUP_RETENTION_DAYS" -exec rm -rf {} +

echo "Production backup created: $DESTINATION"
echo "Backup checksums: $DESTINATION/SHA256SUMS"
