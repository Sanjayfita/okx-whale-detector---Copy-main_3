#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

sh ops/preflight-production.sh

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

GIT_COMMIT="$(git rev-parse HEAD)"
SHORT_COMMIT="$(printf '%s' "$GIT_COMMIT" | cut -c1-12)"
IMAGE_VERSION="${DEPLOY_IMAGE_VERSION:-phase12-$SHORT_COMMIT}"

# Shell environment has higher Compose interpolation precedence than --env-file.
# Export after loading .env.production so stale metadata in that file can never
# override the actual checked-out version being built and deployed.
export APP_GIT_COMMIT="$GIT_COMMIT"
export APP_IMAGE_VERSION="$IMAGE_VERSION"

if [ -f "$PLATFORM_DATA_DIR/platform/paper-state.json" ]; then
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup-production.sh
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build platform
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d database
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrations
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d platform

attempts=0
health_body=""
until health_body="$(curl -fsS "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health" 2>/dev/null)" && \
  printf '%s' "$health_body" | grep -q '"application":"RUNNING"'; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 45 ]; then
    echo "Deployment did not reach application=RUNNING" >&2
    if [ -n "$health_body" ]; then
      echo "Last health response: $health_body" >&2
    fi
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 platform >&2 || true
    exit 1
  fi
  sleep 2
done

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "Deployment reached application=RUNNING."
echo "git_commit=$GIT_COMMIT"
echo "image_version=$IMAGE_VERSION"
echo "Dashboard is not public. From your PC use:"
echo "ssh -L ${DASHBOARD_PORT:-4173}:127.0.0.1:${DASHBOARD_PORT:-4173} <vps-user>@<vps-host>"
