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
cat > "$DATA_DIR/platform/.paper-account-initialized" <<'EOF'
initialized_at_utc=2026-08-09T00:00:00Z
initial_git_commit=test-commit
EOF

expected_paper="$(cat "$DATA_DIR/platform/paper-state.json")"
expected_context="$(cat "$DATA_DIR/platform/trade-contexts.json")"
expected_settings="$(cat "$DATA_DIR/platform/settings.json")"
expected_marker="$(cat "$DATA_DIR/platform/.paper-account-initialized")"

ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR" SKIP_DATABASE_BACKUP=1 \
  sh "$ROOT/ops/backup-production.sh"

BACKUP_SOURCE="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
[ -n "$BACKUP_SOURCE" ]

TAMPERED_SOURCE="$TEMP_ROOT/tampered-backup"
cp -R "$BACKUP_SOURCE" "$TAMPERED_SOURCE"
echo '{"tampered":true}' > "$TAMPERED_SOURCE/paper-state.json"
if ENV_FILE="$ENV_FILE" SKIP_CONTAINER_CONTROL=1 SKIP_PRE_RESTORE_BACKUP=1 \
  sh "$ROOT/ops/restore-production.sh" "$TAMPERED_SOURCE"; then
  echo "Restore unexpectedly accepted a tampered backup" >&2
  exit 1
fi
[ "$(cat "$DATA_DIR/platform/paper-state.json")" = "$expected_paper" ]

SECRET_SOURCE="$TEMP_ROOT/secret-backup"
cp -R "$BACKUP_SOURCE" "$SECRET_SOURCE"
echo 'DO_NOT_UPLOAD=true' > "$SECRET_SOURCE/.env.production"
if ENV_FILE="$ENV_FILE" SKIP_CONTAINER_CONTROL=1 SKIP_PRE_RESTORE_BACKUP=1 \
  sh "$ROOT/ops/restore-production.sh" "$SECRET_SOURCE"; then
  echo "Restore unexpectedly accepted a backup containing secrets" >&2
  exit 1
fi
[ "$(cat "$DATA_DIR/platform/paper-state.json")" = "$expected_paper" ]

echo '{"corrupted":true}' > "$DATA_DIR/platform/paper-state.json"
echo '{"corrupted":true}' > "$DATA_DIR/platform/trade-contexts.json"
echo '{"corrupted":true}' > "$DATA_DIR/platform/settings.json"
echo 'corrupted=true' > "$DATA_DIR/platform/.paper-account-initialized"

ENV_FILE="$ENV_FILE" SKIP_CONTAINER_CONTROL=1 SKIP_PRE_RESTORE_BACKUP=1 \
  sh "$ROOT/ops/restore-production.sh" "$BACKUP_SOURCE"

actual_paper="$(cat "$DATA_DIR/platform/paper-state.json")"
actual_context="$(cat "$DATA_DIR/platform/trade-contexts.json")"
actual_settings="$(cat "$DATA_DIR/platform/settings.json")"
actual_marker="$(cat "$DATA_DIR/platform/.paper-account-initialized")"

[ "$actual_paper" = "$expected_paper" ]
[ "$actual_context" = "$expected_context" ]
[ "$actual_settings" = "$expected_settings" ]
[ "$actual_marker" = "$expected_marker" ]
[ -f "$BACKUP_SOURCE/manifest.txt" ]
[ -f "$BACKUP_SOURCE/checksums.sha256" ]
(
  cd "$BACKUP_SOURCE"
  sha256sum -c checksums.sha256 >/dev/null
)
if find "$BACKUP_SOURCE" -maxdepth 1 -type f -name '.env*' | grep -q .; then
  echo "Backup unexpectedly contains an environment file" >&2
  exit 1
fi

echo "Production backup/restore round-trip passed."
