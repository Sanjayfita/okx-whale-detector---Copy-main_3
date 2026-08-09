#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required" >&2
  exit 1
fi

TEMP_ROOT="$(mktemp -d)"
PROJECT_NAME="phase12-config-$$"
ENV_FILE="$TEMP_ROOT/.env.production"
DATA_DIR="$TEMP_ROOT/data"
mkdir -p "$DATA_DIR/platform"

cleanup() {
  docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
    -f docker-compose.production.yml down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

APP_GIT_COMMIT="${APP_GIT_COMMIT:-ci-config-test}"
APP_IMAGE_VERSION="${APP_IMAGE_VERSION:-phase12-config-test}"
PLATFORM_IMAGE_NAME="${PLATFORM_IMAGE_NAME:-okx-whale-detector}"

cat > "$ENV_FILE" <<EOF
POSTGRES_USER=paperapp
POSTGRES_PASSWORD=ci-only-randomized-password-0123456789abcdef
POSTGRES_DB=research
DATABASE_URL=postgresql://paperapp:ci-only-randomized-password-0123456789abcdef@database:5432/research
PLATFORM_DATA_DIR=$DATA_DIR
PLATFORM_UID=$(id -u)
PLATFORM_GID=$(id -g)
DASHBOARD_PORT=4173
PAPER_STARTING_EQUITY=10000
PAPER_CHECKPOINT_INTERVAL_MS=5000
PLATFORM_HEALTH_CHECK_INTERVAL_MS=30000
APP_GIT_COMMIT=$APP_GIT_COMMIT
APP_IMAGE_VERSION=$APP_IMAGE_VERSION
APP_CONFIGURATION_VERSION=phase12-ci-config
PLATFORM_IMAGE_NAME=$PLATFORM_IMAGE_NAME
EOF

IMAGE_REF="$PLATFORM_IMAGE_NAME:$APP_IMAGE_VERSION"
if ! docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then
  echo "Expected prebuilt production image is missing: $IMAGE_REF" >&2
  exit 1
fi

docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
  -f docker-compose.production.yml create --no-build platform >/dev/null

platform_id="$(
  docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
    -f docker-compose.production.yml ps -a -q platform
)"
database_id="$(
  docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
    -f docker-compose.production.yml ps -a -q database
)"

[ -n "$platform_id" ]
[ -n "$database_id" ]

assert_equal() {
  actual="$1"
  expected="$2"
  description="$3"
  if [ "$actual" != "$expected" ]; then
    echo "$description: expected '$expected', got '$actual'" >&2
    exit 1
  fi
}

platform_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$platform_id")"
printf '%s\n' "$platform_env" | grep -qx 'TRADING_MODE=PAPER'
printf '%s\n' "$platform_env" | grep -qx 'REMOTE_PAPER_ONLY=true'
printf '%s\n' "$platform_env" | grep -qx "APP_GIT_COMMIT=$APP_GIT_COMMIT"
printf '%s\n' "$platform_env" | grep -qx "APP_IMAGE_VERSION=$APP_IMAGE_VERSION"
if printf '%s\n' "$platform_env" | grep -Eq '^OKX_(API_KEY|SECRET|PASSPHRASE)='; then
  echo "Production platform container unexpectedly contains private OKX credentials" >&2
  exit 1
fi

assert_equal \
  "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$platform_id")" \
  "unless-stopped" \
  "platform restart policy"
assert_equal \
  "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$platform_id")" \
  "true" \
  "platform read-only root filesystem"
assert_equal \
  "$(docker inspect --format '{{.HostConfig.PidsLimit}}' "$platform_id")" \
  "256" \
  "platform PID limit"
assert_equal \
  "$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' "$platform_id")" \
  "json-file" \
  "platform log driver"
assert_equal \
  "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$platform_id")" \
  "10m" \
  "platform max log size"
assert_equal \
  "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-file"}}' "$platform_id")" \
  "5" \
  "platform rotated log count"

platform_ports="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$platform_id")"
case "$platform_ports" in
  *'"HostIp":"127.0.0.1"'*'4173'*) ;;
  *)
    echo "Dashboard is not restricted to the host loopback interface: $platform_ports" >&2
    exit 1
    ;;
esac

platform_data_mount="$(
  docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}:{{.Source}}{{end}}{{end}}' "$platform_id"
)"
case "$platform_data_mount" in
  bind:*) ;;
  *)
    echo "Platform /app/data is not a host bind mount: $platform_data_mount" >&2
    exit 1
    ;;
esac

assert_equal \
  "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$database_id")" \
  "unless-stopped" \
  "database restart policy"
database_ports="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$database_id")"
case "$database_ports" in
  *5432*)
    echo "Production PostgreSQL unexpectedly has a host port binding: $database_ports" >&2
    exit 1
    ;;
esac

database_data_mount="$(
  docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}' "$database_id"
)"
case "$database_data_mount" in
  volume:*) ;;
  *)
    echo "PostgreSQL data is not stored in a named volume: $database_data_mount" >&2
    exit 1
    ;;
esac

# Exercise the actual production Compose database and migration services without
# starting the market-data platform. This catches production wiring failures
# while avoiding any claim that CI simulates the real OKX/VPS lifecycle.
docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
  -f docker-compose.production.yml up -d database >/dev/null
attempts=0
until [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$database_id")" = "healthy" ]; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 30 ]; then
    echo "Production PostgreSQL service did not become healthy" >&2
    docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
      -f docker-compose.production.yml logs database >&2 || true
    exit 1
  fi
  sleep 1
done

docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
  -f docker-compose.production.yml run --rm migrations >/dev/null
migration_count="$(
  docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" \
    -f docker-compose.production.yml exec -T database \
    psql -U paperapp -d research -Atc 'SELECT count(*) FROM research.schema_migrations;'
)"
case "$migration_count" in
  ''|*[!0-9]*)
    echo "Could not verify production migrations" >&2
    exit 1
    ;;
esac
if [ "$migration_count" -le 0 ]; then
  echo "Production migrations recorded no schema versions" >&2
  exit 1
fi

echo "Production container configuration and database/migration verification passed."
echo "This proves Compose/container/database configuration only; it is not real VPS lifecycle acceptance."
