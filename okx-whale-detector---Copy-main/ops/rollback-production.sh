#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <previous-image-version>" >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
IMAGE_VERSION="$1"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_IMAGE_NAME:=okx-whale-detector}"
if ! docker image inspect "$PLATFORM_IMAGE_NAME:$IMAGE_VERSION" >/dev/null 2>&1; then
  echo "Rollback image is not available locally: $PLATFORM_IMAGE_NAME:$IMAGE_VERSION" >&2
  exit 1
fi

if [ -f "$PLATFORM_DATA_DIR/platform/paper-state.json" ]; then
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup-production.sh
fi

export APP_IMAGE_VERSION="$IMAGE_VERSION"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build platform

attempts=0
until curl -fsS "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health" >/dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 45 ]; then
    echo "Rollback image failed health check" >&2
    exit 1
  fi
  sleep 2
done

echo "Rollback complete: $PLATFORM_IMAGE_NAME:$IMAGE_VERSION"
