#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

command -v docker >/dev/null 2>&1 || { echo "Docker is required" >&2; exit 1; }
docker compose version >/dev/null

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

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_DATA_DIR:?PLATFORM_DATA_DIR is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"

case "$POSTGRES_PASSWORD" in
  REPLACE_*|CHANGE_*|password|postgres)
    echo "POSTGRES_PASSWORD is still a placeholder/unsafe default" >&2
    exit 1
    ;;
esac

if env | grep -Eq '^OKX_(API_KEY|SECRET|PASSPHRASE)='; then
  echo "Remove OKX private trading credentials: Phase 12 uses public market data only." >&2
  exit 1
fi

mkdir -p "$PLATFORM_DATA_DIR/platform"
if [ ! -w "$PLATFORM_DATA_DIR" ]; then
  echo "PLATFORM_DATA_DIR is not writable: $PLATFORM_DATA_DIR" >&2
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

echo "Production preflight passed. Dashboard remains bound to VPS loopback only."
