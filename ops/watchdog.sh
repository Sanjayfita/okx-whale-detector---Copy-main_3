#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/tmp/okx-paper-watchdog}"
RESTART_COOLDOWN_SECONDS="${WATCHDOG_RESTART_COOLDOWN_SECONDS:-600}"
RESTART_ALERT_THRESHOLD="${WATCHDOG_RESTART_ALERT_THRESHOLD:-3}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${PLATFORM_DATA_DIR:?PLATFORM_DATA_DIR is required}"
mkdir -p "$STATE_DIR"

alert() {
  message="$1"
  echo "$message" >&2
  if [ -z "${OPS_ALERT_WEBHOOK_URL:-}" ]; then return; fi
  escaped=$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')
  curl -fsS --max-time 10 \
    -H 'content-type: application/json' \
    -d "{\"type\":\"ERROR\",\"title\":\"OKX paper production watchdog\",\"message\":\"$escaped\"}" \
    "$OPS_ALERT_WEBHOOK_URL" >/dev/null || true
}

restart_platform_if_allowed() {
  now=$(date +%s)
  last=0
  if [ -f "$STATE_DIR/last-restart" ]; then last=$(cat "$STATE_DIR/last-restart" 2>/dev/null || echo 0); fi
  if [ $((now - last)) -lt "$RESTART_COOLDOWN_SECONDS" ]; then
    alert "Platform is unreachable, but watchdog restart is rate-limited."
    return
  fi
  echo "$now" > "$STATE_DIR/last-restart"
  alert "Platform health endpoint is unreachable; restarting the paper platform container."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" restart platform || \
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d platform
}

healthy_pass=1
health_body=''
if health_body=$(curl -sS --max-time 10 "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health" 2>/dev/null); then
  if printf '%s' "$health_body" | grep -q '"application":"FAILED"'; then
    healthy_pass=0
    alert "Platform reports FAILED health. Inspect persistence/paper-engine status before restarting."
  elif printf '%s' "$health_body" | grep -q '"application":"DEGRADED"'; then
    healthy_pass=0
    alert "Platform reports DEGRADED health. Inspect OKX connectivity, stale market data, risk state, and disk status."
  fi
else
  healthy_pass=0
  restart_platform_if_allowed
fi

container_id=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q platform 2>/dev/null || true)
if [ -n "$container_id" ]; then
  restart_count=$(docker inspect -f '{{.RestartCount}}' "$container_id" 2>/dev/null || echo 0)
  if [ "$restart_count" -ge "$RESTART_ALERT_THRESHOLD" ]; then
    healthy_pass=0
    alert "Platform container restart count is $restart_count (threshold $RESTART_ALERT_THRESHOLD)."
  fi
fi

used_percent=$(df -Pk "$PLATFORM_DATA_DIR" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
if [ -n "$used_percent" ] && [ "$used_percent" -ge 90 ]; then
  healthy_pass=0
  alert "Platform data filesystem is ${used_percent}% used."
fi

# Optional external dead-man/heartbeat service. The endpoint should be configured
# to alert when scheduled pings stop; therefore a full VPS/provider outage can be
# detected even though no process on the failed VPS can send its own alert.
if [ "$healthy_pass" -eq 1 ] && [ -n "${OPS_HEARTBEAT_URL:-}" ]; then
  curl -fsS --max-time 10 "$OPS_HEARTBEAT_URL" >/dev/null || \
    echo "External watchdog heartbeat delivery failed" >&2
fi
