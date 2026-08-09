#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TEMP_ROOT="$(mktemp -d)"
PROJECT_NAME="okx-paper-restore-test-$$"
ENV_FILE="$TEMP_ROOT/.env.production"
DATA_DIR="$TEMP_ROOT/data"
BACKUP_DIR="$TEMP_ROOT/backups"
COMPOSE_FILE="$ROOT/docker-compose.production.yml"

cleanup() {
  COMPOSE_PROJECT_NAME="$PROJECT_NAME" docker compose --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$DATA_DIR/platform"
cat > "$ENV_FILE" <<EOF
POSTGRES_USER=paperapp
POSTGRES_PASSWORD=test-only-database-password
POSTGRES_DB=research
DATABASE_URL=postgresql://paperapp:test-only-database-password@database:5432/research
REMOTE_PAPER_ONLY=true
PLATFORM_DATA_DIR=$DATA_DIR
PLATFORM_UID=$(id -u)
PLATFORM_GID=$(id -g)
DASHBOARD_PORT=4173
APP_GIT_COMMIT=test-database-restore
APP_IMAGE_VERSION=test-database-restore
APP_CONFIGURATION_VERSION=test-database-restore
EOF
chmod 600 "$ENV_FILE"

cat > "$DATA_DIR/platform/paper-state.json" <<'EOF'
{"schemaVersion":1,"savedAt":123,"account":{},"risk":{},"context":{}}
EOF
cat > "$DATA_DIR/platform/.paper-account-initialized" <<'EOF'
initialized_at_utc=2026-08-09T00:00:00Z
initial_git_commit=test-database-restore
EOF

export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d database
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrations
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
  psql -U paperapp -d research -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE research.phase12_restore_probe (value text PRIMARY KEY); INSERT INTO research.phase12_restore_probe VALUES ('verified');"

ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" BACKUP_DIR="$BACKUP_DIR" \
  sh "$ROOT/ops/backup-production.sh"
BACKUP_SOURCE="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \
  -name '????????T??????Z' | sort | tail -n 1)"
[ -n "$BACKUP_SOURCE" ]
[ -s "$BACKUP_SOURCE/research.dump" ]

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
  createdb -U paperapp research_restore
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
  pg_restore --no-owner --exit-on-error -U paperapp -d research_restore \
  < "$BACKUP_SOURCE/research.dump"

probe="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
  psql -U paperapp -d research_restore -At -v ON_ERROR_STOP=1 \
  -c "SELECT value FROM research.phase12_restore_probe")"
[ "$probe" = "verified" ]
migration_count="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database \
  psql -U paperapp -d research_restore -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM research.schema_migrations")"
[ "$migration_count" -ge 6 ]

echo "Disposable PostgreSQL backup/restore verification passed."
