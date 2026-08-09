#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

body="$(curl -fsS --max-time 10 "http://127.0.0.1:${DASHBOARD_PORT:-4173}/api/health")"

if ! printf '%s' "$body" | grep -q '"liveExecutionAllowed":false'; then
  echo "Health response did not prove that live execution is disabled" >&2
  exit 1
fi
for required in \
  '"okxRest":{"status":"CONNECTED"' \
  '"okxWebSocket":{"status":"CONNECTED"' \
  '"marketData":{"status":"HEALTHY"' \
  '"timeframeState":"READY"' \
  '"paperEngine":{"status":"HEALTHY"' \
  '"persistence":{"status":"HEALTHY"' \
  '"disk":{"status":"HEALTHY"'; do
  if ! printf '%s' "$body" | grep -q "$required"; then
    echo "Platform has not reached operationally ready health: $body" >&2
    exit 1
  fi
done

if printf '%s' "$body" | grep -q '"strategy":{"status":"PAUSED"'; then
  if ! printf '%s' "$body" | grep -Eq '"(killSwitchActive|circuitBreakerActive)":true'; then
    echo "Strategy is paused without a persisted risk-control reason: $body" >&2
    exit 1
  fi
elif ! printf '%s' "$body" | grep -q '"strategy":{"status":"RUNNING"'; then
  echo "Platform returned an unrecognized strategy health state: $body" >&2
  exit 1
fi

printf '%s\n' "$body"
