#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/preflight-production.sh

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

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Refusing to deploy a dirty Git checkout; commit or remove unintended files first." >&2
  exit 1
fi

ACCOUNT_MARKER="$PLATFORM_DATA_DIR/platform/.paper-account-initialized"
PAPER_STATE="$PLATFORM_DATA_DIR/platform/paper-state.json"
if [ -f "$ACCOUNT_MARKER" ] && [ ! -f "$PAPER_STATE" ]; then
  echo "Paper account marker exists but paper-state.json is missing; refusing to initialize an empty account." >&2
  exit 1
fi
if [ ! -f "$PAPER_STATE" ] && [ "${ALLOW_NEW_PAPER_ACCOUNT:-0}" != "1" ]; then
  echo "No existing paper account found. For the first deployment only, rerun with ALLOW_NEW_PAPER_ACCOUNT=1." >&2
  exit 1
fi
if [ -f "$PAPER_STATE" ]; then
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" sh ops/backup-production.sh
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build platform
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d database
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrations
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d platform

attempts=0
until ENV_FILE="$ENV_FILE" sh ops/check-production-health.sh >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 45 ]; then
    echo "Deployment failed health check" >&2
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 platform >&2 || true
    exit 1
  fi
  sleep 2
done

if [ ! -f "$PAPER_STATE" ]; then
  echo "Deployment reached RUNNING health without durable paper-state.json" >&2
  exit 1
fi
if [ ! -f "$ACCOUNT_MARKER" ]; then
  umask 077
  {
    echo "initialized_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "initial_git_commit=$GIT_COMMIT"
  } > "$ACCOUNT_MARKER"
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
ENV_FILE="$ENV_FILE" sh ops/check-production-health.sh

echo "Deployment healthy."
echo "git_commit=$GIT_COMMIT"
echo "image_version=$IMAGE_VERSION"
echo "Dashboard is not public. From your PC use:"
echo "ssh -L ${DASHBOARD_PORT:-4173}:127.0.0.1:${DASHBOARD_PORT:-4173} <vps-user>@<vps-host>"
