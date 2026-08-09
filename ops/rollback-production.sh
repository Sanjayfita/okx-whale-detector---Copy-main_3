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
IMAGE_REF="$PLATFORM_IMAGE_NAME:$IMAGE_VERSION"
if ! docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then
  echo "Rollback image is not available locally: $IMAGE_REF" >&2
  exit 1
fi

# Compose injects deployment identity at container start, so a rollback must
# recover the Git SHA baked into the selected image rather than reuse metadata
# from the current checkout/.env.production. Refuse an image without trustworthy
# identity so future paper trades cannot be attributed to the wrong code.
ROLLBACK_GIT_COMMIT="$(
  docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE_REF" |
    sed -n 's/^APP_GIT_COMMIT=//p' |
    tail -n 1
)"
if [ -z "$ROLLBACK_GIT_COMMIT" ] || [ "$ROLLBACK_GIT_COMMIT" = "unknown" ]; then
  echo "Rollback image does not contain a trustworthy APP_GIT_COMMIT; refusing rollback: $IMAGE_REF" >&2
  exit 1
fi

if [ -f "$PLATFORM_DATA_DIR/platform/paper-state.json" ]; then
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup-production.sh
fi

export APP_GIT_COMMIT="$ROLLBACK_GIT_COMMIT"
export APP_IMAGE_VERSION="$IMAGE_VERSION"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build platform

attempts=0
health_body=""
until health_body="$(curl -fsS "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health" 2>/dev/null)" && \
  printf '%s' "$health_body" | grep -q '"application":"RUNNING"'; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 45 ]; then
    echo "Rollback image did not reach application=RUNNING" >&2
    if [ -n "$health_body" ]; then
      echo "Last health response: $health_body" >&2
    fi
    exit 1
  fi
  sleep 2
done

echo "Rollback complete and application=RUNNING: $IMAGE_REF"
echo "git_commit=$ROLLBACK_GIT_COMMIT"
