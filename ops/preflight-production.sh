#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "Docker is required" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Git is required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Production deployment must run from a Git checkout." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Production checkout is dirty. Commit, stash, or remove local source changes before deployment so APP_GIT_COMMIT exactly identifies the image." >&2
  git status --short >&2 || true
  exit 1
fi
GIT_COMMIT="$(git rev-parse HEAD)"
echo "Git checkout: clean ($GIT_COMMIT)"

if command -v systemctl >/dev/null 2>&1; then
  docker_enabled="$(systemctl is-enabled docker 2>/dev/null || true)"
  if [ "$docker_enabled" != "enabled" ]; then
    echo "Docker service must be enabled at boot for unattended VPS reboot recovery (current: ${docker_enabled:-unknown})." >&2
    exit 1
  fi
  echo "Docker boot service: enabled"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and edit it on the VPS." >&2
  exit 1
fi

if command -v stat >/dev/null 2>&1; then
  env_mode="$(stat -c '%a' "$ENV_FILE")"
  case "$env_mode" in
    *00) ;;
    *)
      echo "$ENV_FILE must not be readable or writable by group/other (current mode: $env_mode)" >&2
      exit 1
      ;;
  esac
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_DATA_DIR:?PLATFORM_DATA_DIR is required}"
: "${PLATFORM_UID:?PLATFORM_UID is required}"
: "${PLATFORM_GID:?PLATFORM_GID is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${REMOTE_PAPER_ONLY:?REMOTE_PAPER_ONLY is required}"

if [ "$REMOTE_PAPER_ONLY" != "true" ]; then
  echo "REMOTE_PAPER_ONLY must be exactly true" >&2
  exit 1
fi

case "$PLATFORM_UID:$PLATFORM_GID" in
  *[!0-9:]*|:*|*:)
    echo "PLATFORM_UID and PLATFORM_GID must be numeric" >&2
    exit 1
    ;;
esac

case "$POSTGRES_PASSWORD" in
  REPLACE_*|CHANGE_*|password|postgres)
    echo "POSTGRES_PASSWORD is still a placeholder/unsafe default" >&2
    exit 1
    ;;
esac

expected_database_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@database:5432/${POSTGRES_DB}"
if [ "$DATABASE_URL" != "$expected_database_url" ]; then
  echo "DATABASE_URL must match POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, and the private database service" >&2
  exit 1
fi

if env | grep -Eq '^OKX_[A-Z0-9_]*(API_KEY|SECRET|PASSPHRASE)[A-Z0-9_]*='; then
  echo "Remove OKX private trading credentials: Phase 12 uses public market data only." >&2
  exit 1
fi

mkdir -p "$PLATFORM_DATA_DIR/platform"
if [ ! -w "$PLATFORM_DATA_DIR" ]; then
  echo "PLATFORM_DATA_DIR is not writable: $PLATFORM_DATA_DIR" >&2
  exit 1
fi

data_uid="$(stat -c '%u' "$PLATFORM_DATA_DIR")"
data_gid="$(stat -c '%g' "$PLATFORM_DATA_DIR")"
if [ "$data_uid" != "$PLATFORM_UID" ] || [ "$data_gid" != "$PLATFORM_GID" ]; then
  echo "PLATFORM_DATA_DIR must be owned by ${PLATFORM_UID}:${PLATFORM_GID} (current: ${data_uid}:${data_gid})" >&2
  exit 1
fi

if command -v timedatectl >/dev/null 2>&1; then
  ntp="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"
  if [ "$ntp" = "no" ]; then
    echo "Server clock is not NTP synchronized." >&2
    exit 1
  fi
  echo "NTP synchronized: $ntp"
else
  echo "timedatectl unavailable; verify NTP synchronization with the VPS provider." >&2
fi

echo "UTC now: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "CPU cores: $(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"
if command -v free >/dev/null 2>&1; then free -h; fi
df -h "$PLATFORM_DATA_DIR"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

resolved_config="$(mktemp)"
trap 'rm -f "$resolved_config"' EXIT INT TERM
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config > "$resolved_config"
if ! grep -q 'host_ip: 127.0.0.1' "$resolved_config"; then
  echo "Production dashboard must publish only on 127.0.0.1" >&2
  exit 1
fi
if grep -q 'host_ip: 0.0.0.0' "$resolved_config"; then
  echo "Production configuration contains a public host binding" >&2
  exit 1
fi
if ! grep -q 'REMOTE_PAPER_ONLY: "true"' "$resolved_config" ||
   ! grep -q 'TRADING_MODE: PAPER' "$resolved_config"; then
  echo "Resolved production configuration is not locked to remote PAPER mode" >&2
  exit 1
fi

database_config="$(mktemp)"
trap 'rm -f "$resolved_config" "$database_config"' EXIT INT TERM
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config database > "$database_config"
if grep -q '^    ports:' "$database_config"; then
  echo "PostgreSQL must not publish a host port" >&2
  exit 1
fi

echo "Production preflight passed. Dashboard remains bound to VPS loopback only."
