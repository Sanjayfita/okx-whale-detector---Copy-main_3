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

ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/preflight-production.sh

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_IMAGE_NAME:=okx-whale-detector}"
if ! docker image inspect "$PLATFORM_IMAGE_NAME:$IMAGE_VERSION" >/dev/null 2>&1; then
  echo "Rollback image is not available locally: $PLATFORM_IMAGE_NAME:$IMAGE_VERSION" >&2
  exit 1
fi

IMAGE_GIT_COMMIT="$(docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$PLATFORM_IMAGE_NAME:$IMAGE_VERSION")"
if [ -z "$IMAGE_GIT_COMMIT" ] || [ "$IMAGE_GIT_COMMIT" = "<no value>" ] ||
   [ "$IMAGE_GIT_COMMIT" = "unknown" ]; then
  IMAGE_GIT_COMMIT="${ROLLBACK_GIT_COMMIT:-}"
fi
if [ -z "$IMAGE_GIT_COMMIT" ]; then
  echo "Rollback image has no Git revision label. Set ROLLBACK_GIT_COMMIT to its verified commit." >&2
  exit 1
fi

if [ ! -f "$PLATFORM_DATA_DIR/platform/paper-state.json" ]; then
  echo "Refusing rollback because the persistent paper account is missing" >&2
  exit 1
fi
ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup-production.sh

export APP_IMAGE_VERSION="$IMAGE_VERSION"
export APP_GIT_COMMIT="$IMAGE_GIT_COMMIT"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build platform

attempts=0
until ENV_FILE="$ENV_FILE" sh ops/check-production-health.sh >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 45 ]; then
    echo "Rollback image failed health check" >&2
    exit 1
  fi
  sleep 2
done

ENV_FILE="$ENV_FILE" sh ops/check-production-health.sh
echo "Rollback complete: $PLATFORM_IMAGE_NAME:$IMAGE_VERSION"
echo "git_commit=$IMAGE_GIT_COMMIT"
