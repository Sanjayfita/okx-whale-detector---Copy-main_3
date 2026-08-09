#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT INT TERM

DATA_DIR="$TEMP_ROOT/data"
BACKUP_DIR="$TEMP_ROOT/backups"
ENV_FILE="$TEMP_ROOT/.env.production"
mkdir -p "$DATA_DIR/platform"

cat > "$ENV_FILE" <<EOF
PLATFORM_DATA_DIR=$DATA_DIR
PLATFORM_UID=$(id -u)
PLATFORM_GID=$(id -g)
POSTGRES_USER=paperapp
POSTGRES_PASSWORD=test-only
POSTGRES_DB=research
DASHBOARD_PORT=4173
APP_GIT_COMMIT=test-commit
APP_IMAGE_VERSION=test-image
APP_CONFIGURATION_VERSION=test-config
EOF

cat > "$DATA_DIR/platform/paper-state.json" <<'EOF'
{"schemaVersion":1,"savedAt":123,"account":{},"risk":{},"context":{}}
EOF
cat > "$DATA_DIR/platform/trade-contexts.json" <<'EOF'
{"schemaVersion":1,"records":[{"tradeId":"trade-1"}]}
EOF
cat > "$DATA_DIR/platform/settings.json" <<'EOF'
{"mode":"PAPER"}
EOF

expected_paper="$(cat "$DATA_DIR/platform/paper-state.json")"
expected_context="$(cat "$DATA_DIR/platform/trade-contexts.json")"

ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR" SKIP_DATABASE_BACKUP=1 \
  sh "$ROOT/ops/backup-production.sh"

BACKUP_SOURCE="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
[ -n "$BACKUP_SOURCE" ]

echo '{"corrupted":true}' > "$DATA_DIR/platform/paper-state.json"
echo '{"corrupted":true}' > "$DATA_DIR/platform/trade-contexts.json"

ENV_FILE="$ENV_FILE" SKIP_CONTAINER_CONTROL=1 \
  sh "$ROOT/ops/restore-production.sh" "$BACKUP_SOURCE"

actual_paper="$(cat "$DATA_DIR/platform/paper-state.json")"
actual_context="$(cat "$DATA_DIR/platform/trade-contexts.json")"

[ "$actual_paper" = "$expected_paper" ]
[ "$actual_context" = "$expected_context" ]

echo "Production backup/restore round-trip passed."
