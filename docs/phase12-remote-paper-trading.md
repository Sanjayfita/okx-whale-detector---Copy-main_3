# Phase 12 — Remote 24/7 Paper Trading

## Scope

Phase 12 is operational reliability only. It does not validate profitability and it does not enable live order execution.

Production is locked to `PAPER` mode with `REMOTE_PAPER_ONLY=true`. The production API rejects attempts to switch to `LIVE` mode and every existing execution result continues to expose `liveExecutionAllowed: false`.

## Architecture

```text
Windows PC (optional, can be off)
        |
        | SSH authentication + local port forward when dashboard access is needed
        v
Remote Linux VPS
        |
        +-- Docker Engine / Compose
              |
              +-- postgres:16 (private Compose network only)
              +-- migrations (one-shot during deployment)
              +-- trading platform
                    +-- public OKX REST
                    +-- public OKX candle WebSocket
                    +-- EMA strategy
                    +-- paper engine/risk manager
                    +-- /app/data persistence
                    +-- dashboard/API on container port 4173

Host exposure: 127.0.0.1:4173 only
Public dashboard port: none
Public PostgreSQL port: none
```

Kubernetes is intentionally not used. One VPS and Docker Compose are sufficient for the current single-process paper platform.

## Local development vs remote production

Local development continues to use `docker-compose.yml`, `npm run start`, VS Code, and the existing Windows workflow.

Remote production uses:

- `docker-compose.production.yml`
- `.env.production` stored only on the VPS
- `ops/deploy-production.sh`
- persistent host data outside the Git checkout
- Docker restart policies
- Docker health checks
- the host watchdog
- daily backups

The production runtime does not require the Windows PC, PowerShell, VS Code, or a manually running npm command.

## Production data locations

Recommended VPS layout:

```text
/opt/okx-whale-detector/
  repo/                         Git checkout
  data/
    platform/
      paper-state.json          Phase 11 paper account source records
      trade-contexts.json       per-trade deployment/config traceability
      settings.json             dashboard/strategy settings
  backups/                      daily backups; mode 0700 recommended
```

`PLATFORM_DATA_DIR=/opt/okx-whale-detector/data` is bind-mounted to `/app/data`.

Critical paper state therefore survives container deletion/replacement, Docker daemon restart, and VPS reboot.

PostgreSQL uses the persistent Docker volume `okx-paper-production_postgres-data`. Research DB backups are produced with `pg_dump` by the backup script.

## Secrets and OKX permissions

Copy `.env.production.example` to `.env.production` on the VPS and never commit the real file.

Use a URL-safe random PostgreSQL password, for example a hex token generated on the VPS. The Phase 12 runtime uses OKX public market-data REST/WebSocket APIs and does not need an OKX API key, secret, passphrase, or trading permission.

The production preflight fails if `OKX_API_KEY`, `OKX_SECRET`, or `OKX_PASSPHRASE` are present in the environment.

Notification credentials are optional environment variables. They must remain in `.env.production` or the VPS secret mechanism, never source code, Dockerfiles, committed Compose files, logs, or dashboard responses.

## First VPS setup

Install Git, Docker Engine, and the Docker Compose plugin using the VPS provider/OS supported procedure. Ensure the Docker service is enabled at boot.

Create the deployment directories:

```sh
sudo mkdir -p /opt/okx-whale-detector/{data/platform,backups}
sudo chown -R "$USER":"$USER" /opt/okx-whale-detector
```

Clone the repository and enter the actual Node project:

```sh
cd /opt/okx-whale-detector
git clone https://github.com/Sanjayfita/okx-whale-detector---Copy-main_3.git repo
cd repo/okx-whale-detector---Copy-main
git switch agent/trading-platform-foundation
```

Create the production environment file:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Set at minimum:

- `POSTGRES_PASSWORD`
- the matching URL-safe password inside `DATABASE_URL`
- `PLATFORM_DATA_DIR=/opt/okx-whale-detector/data`
- deployment metadata values if not using the deployment script overrides

The platform container runs as UID/GID 1000 by default. Prepare the data directory before deployment:

```sh
sudo chown -R 1000:1000 /opt/okx-whale-detector/data
sudo chmod -R u+rwX,go-rwx /opt/okx-whale-detector/data
chmod 700 /opt/okx-whale-detector/backups
```

Run preflight:

```sh
sh ops/preflight-production.sh
```

Preflight verifies Docker/Compose, production configuration, non-placeholder DB credentials, absence of unnecessary OKX private credentials, persistent-directory writeability, UTC/NTP state where available, and available disk information.

## Deployment

The manual deployment sequence is deliberately reproducible:

```text
Git checkout
  -> preflight
  -> back up existing paper state
  -> build versioned image
  -> start database
  -> run migrations
  -> replace platform container
  -> load existing paper state
  -> restart reconciliation
  -> recover candle history
  -> health check
  -> resume paper trading
```

Run:

```sh
sh ops/deploy-production.sh
```

The script stamps the current Git commit into the image/runtime and uses image version `phase12-<12-char-sha>` unless explicitly overridden.

Existing `/opt/okx-whale-detector/data` is never removed by deployment.

## Secure remote dashboard access

Do not open TCP 4173 in the VPS firewall/security group.

`docker-compose.production.yml` publishes only:

```text
127.0.0.1:4173 -> platform:4173
```

From Windows PowerShell, authenticate to the VPS and create a tunnel:

```powershell
ssh -L 4173:127.0.0.1:4173 <vps-user>@<vps-host>
```

Keep that SSH session open while using the dashboard, then open:

```text
http://127.0.0.1:4173
```

Authentication and authorization are therefore provided by the VPS SSH boundary. A network client that is not authenticated to the VPS cannot reach the dashboard/API port.

Prefer SSH keys and disable password SSH login once key access has been verified. Only the SSH port needs to be internet-reachable for this design.

## Health endpoint

`GET /api/health` reports operational state without credentials or private configuration:

```text
application: RUNNING / DEGRADED / FAILED
okxRest: CONNECTED / FAILED
okxWebSocket: CONNECTED / DISCONNECTED
marketData: HEALTHY / STALE
strategy: RUNNING / PAUSED
paperEngine: HEALTHY / FAILED
persistence: HEALTHY / FAILED
disk: HEALTHY / LOW
last candle timestamp
last live candle receipt time
last successful persistence
last strategy evaluation
deployment Git/image/config versions
```

A `FAILED` application response returns HTTP 503. `DEGRADED` remains HTTP 200 so Docker does not create a restart loop for a recoverable exchange/network condition.

The Compose health check calls this endpoint every 30 seconds.

## Stale market-data recovery

The candle WebSocket already has heartbeat timeout detection and bounded exponential reconnect backoff.

Phase 12 additionally distinguishes live candle receipt from historical REST replay. If no live candle arrives for the selected timeframe within the health threshold, the platform:

1. marks market data `STALE`;
2. pauses strategy health status;
3. logs/notifies the degradation;
4. force-reconnects the candle WebSocket with a recovery cooldown;
5. lets the existing reconnect callback trigger history reconciliation;
6. fetches confirmed native-timeframe candles through OKX REST;
7. retries temporary REST failures with bounded exponential backoff;
8. replays history under the existing Phase 11 execution barrier;
9. resumes live evaluation when live candles return.

Historical recovery never counts as a fresh live-candle receipt and cannot create retroactive paper executions.

Phase 11 fill/funding idempotency remains the account-level duplicate-event defense.

## Logging and disk protection

Production services use Docker `json-file` logging with:

```text
max-size: 10m
max-file: 5
```

This bounds container log growth without deleting paper-account evidence.

The health endpoint also reports disk status. It becomes `LOW` below either 10% free space or 1 GiB free space.

`ops/watchdog.sh` additionally checks host filesystem usage and alerts at 90% used.

No trade/account evidence is automatically deleted. Backup retention applies only to dated backup directories.

## Notifications and watchdog

Application-level health transitions use the existing Discord/Telegram/email-relay/generic webhook notification service when configured.

The host watchdog detects:

- dashboard/application not responding;
- application `FAILED`/`DEGRADED` state;
- repeated container restarts;
- high disk usage.

If the health endpoint is unreachable, it can restart the platform container, but the restart is rate-limited (default ten minutes) to prevent a tight restart loop.

Run it manually:

```sh
sh ops/watchdog.sh
```

Recommended cron cadence:

```cron
*/5 * * * * cd /opt/okx-whale-detector/repo/okx-whale-detector---Copy-main && sh ops/watchdog.sh 2>&1 | logger -t okx-paper-watchdog
```

A watchdog running on the VPS cannot notify if the entire VPS/provider is offline. For that failure class, use the VPS provider's external monitoring or an external dead-man/heartbeat service. That is an external operational dependency, not something the trading container can truthfully self-detect while powered off.

## Backups

Daily backup command:

```sh
BACKUP_DIR=/opt/okx-whale-detector/backups sh ops/backup-production.sh
```

The backup includes when present:

- `paper-state.json`
- `trade-contexts.json`
- `settings.json`
- PostgreSQL `research.dump`
- non-secret deployment manifest

`.env.production` is intentionally not copied.

Default retention is 14 days. Override with `BACKUP_RETENTION_DAYS` if required.

Recommended daily cron:

```cron
15 2 * * * cd /opt/okx-whale-detector/repo/okx-whale-detector---Copy-main && BACKUP_DIR=/opt/okx-whale-detector/backups sh ops/backup-production.sh 2>&1 | logger -t okx-paper-backup
```

For disk/server-loss protection, copy encrypted backups off the VPS using the provider backup service or another controlled destination. Local daily backups protect against accidental/corrupt state replacement but not total VPS disk loss.

## Restore procedure

List backups:

```sh
ls -lah /opt/okx-whale-detector/backups
```

Restore paper state/config/context from one backup:

```sh
sh ops/restore-production.sh /opt/okx-whale-detector/backups/<timestamp>
```

The restore procedure:

1. validates JSON before touching current state;
2. stops the platform;
3. replaces each state file through a temporary sibling file;
4. preserves configured container UID/GID ownership;
5. starts the database;
6. reruns idempotent migrations;
7. starts the platform;
8. waits for the local health endpoint.

Research DB restoration is intentionally opt-in:

```sh
RESTORE_RESEARCH_DB=1 sh ops/restore-production.sh /opt/okx-whale-detector/backups/<timestamp>
```

CI runs `ops/verify-backup-restore.sh`, which creates paper state, backs it up, corrupts the live copy, restores it, and byte-compares the recovered account/context files. This makes the restore procedure tested rather than documentation-only.

## Time synchronization

The production container sets `TZ=UTC`. Paper/candle/fill/funding/journal timestamps remain epoch milliseconds/UTC as in the existing platform.

Before deployment:

```sh
timedatectl status
date -u
```

`ops/preflight-production.sh` fails when `timedatectl` explicitly reports that NTP is not synchronized.

## Resource measurement

Do not select a final production size from an unmeasured guess.

After the platform has been running under representative load, collect actual host/container usage:

```sh
sh ops/measure-resources.sh
```

The report includes host CPU count, RAM, disk, per-container CPU/memory/network/block I/O, total persistent-data size, and the individual state-file sizes.

Collect at least several samples during normal operation and during history recovery. Only then set a minimum/recommended VPS size and optional hard Compose CPU/RAM limits.

Until those measurements exist, resource sizing is `IN PROGRESS`, not `DONE`.

## Container crash test

With the platform running:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl -s http://127.0.0.1:4173/api/health
```

Capture the current snapshot/paper state, then kill only the platform process/container:

```sh
docker kill "$(docker compose --env-file .env.production -f docker-compose.production.yml ps -q platform)"
```

Because the service uses `restart: unless-stopped`, Docker should restart it automatically.

Verify:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl -s http://127.0.0.1:4173/api/health
```

Confirm positions, trade history, equity, risk state, stops, targets and trailing stop are unchanged except for legitimate new market marks/events after restart.

## VPS reboot test

Do this only after SSH access and provider console access are confirmed.

Before reboot:

```sh
curl -s http://127.0.0.1:4173/api/health
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Then:

```sh
sudo reboot
```

After the server is reachable again:

```sh
cd /opt/okx-whale-detector/repo/okx-whale-detector---Copy-main
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl -s http://127.0.0.1:4173/api/health
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 platform
```

Evidence must show Docker started, the platform container started automatically, paper reconciliation ran, missing candles were recovered, OKX reconnected, and the paper account remained intact.

## Network failure test

Prefer doing this while the strategy is on a short timeframe so stale detection can be observed without waiting hours.

Record health and paper-state checksums first. Then temporarily disconnect only the platform container from its Compose network from the VPS host. Keep provider console access available in case of mistakes.

After reconnecting the network, verify logs show WebSocket reconnect and candle history reconciliation, then verify:

- no duplicate paper trades;
- no duplicate fills;
- no duplicate funding;
- risk state did not reset;
- no retroactive historical trades;
- health returned from `DEGRADED` to `RUNNING`.

Phase 11 idempotency tests remain the deterministic duplicate-event proof; this remote test adds operational evidence around the real container/network lifecycle.

## Safe update and rollback

Normal update:

```text
persist current account
 -> daily/pre-deploy backup
 -> build new versioned image
 -> run migrations
 -> replace platform container
 -> restore/reconcile existing /app/data
 -> health check
 -> resume
```

Use:

```sh
sh ops/deploy-production.sh
```

Docker keeps previously built version tags unless pruned. Roll back application code without deleting paper state:

```sh
sh ops/rollback-production.sh <previous-image-version>
```

If a future release contains a non-backward-compatible database/state migration, it must define its own rollback/migration policy. Phase 12 does not introduce a DB schema migration.

## Per-trade version/config traceability

For every new paper trade opened by the Phase 12 runtime, `trade-contexts.json` records:

- trade ID;
- instrument;
- strategy ID/version;
- timeframe;
- complete strategy configuration;
- SHA-256 strategy-config fingerprint;
- Git commit;
- Docker image version;
- configuration version;
- record timestamp.

This context is immutable by trade ID. It does not rewrite older pre-Phase-12 historical trades with guessed version metadata.

## Remote acceptance evidence checklist

Do not declare remote paper production `READY` from CI alone. On the actual VPS, collect evidence for:

1. production preflight;
2. production Compose start;
3. detailed `/api/health`;
4. paper account loaded;
5. OKX REST connected;
6. OKX WebSocket connected;
7. strategy evaluations occurring;
8. at least one natural paper trade and persisted state;
9. container kill + automatic restart + identical recovered position/account state;
10. network interruption + reconnect + backfill + no duplicates;
11. VPS reboot + Docker automatic restart + reconciliation;
12. backup creation;
13. backup restore test;
14. resource measurement;
15. secure SSH-tunnel dashboard access.

Repository/CI readiness and real VPS acceptance are separate milestones.

## Gap status after repository implementation

### Infrastructure

- remote deployment tooling: **DONE (repository side); VPS execution NOT STARTED**
- monitoring: **DONE (application + host watchdog); external host-down monitor NOT STARTED**
- alerts: **DONE when a notification channel is configured; external host-down alert NOT STARTED**
- backups: **DONE locally on VPS; off-host copy NOT STARTED**
- log rotation: **DONE**
- authentication: **DONE by SSH/private loopback design; VPS SSH hardening requires deployment evidence**
- health checks: **DONE**
- automatic process/container recovery: **DONE**
- actual server-reboot evidence: **NOT STARTED**

### Trading-data correctness

- real OKX funding settlement ingestion: **BLOCKED** pending verified settlement-time mark/notional evidence
- candle synchronization/restart recovery: **DONE**
- WebSocket heartbeat/reconnect: **DONE**
- stale-stream detection/recovery: **DONE**
- temporary REST retry/backoff: **DONE**
- slippage modeling: **DONE in existing execution simulator**
- spread modeling: **DONE in existing execution simulator**
- latency modeling: **DONE in existing execution simulator**

### Strategy validation

- multi-timeframe comparison: **NOT STARTED**
- multi-instrument comparison: **NOT STARTED**
- cost validation: **NOT STARTED**
- whale baseline comparison: **NOT STARTED**
- PurgedWalkForward evaluation: **NOT STARTED**
- execution Monte Carlo validation: **NOT STARTED**
- untouched holdout: **NOT STARTED**

### Operational validation

- real VPS Phase 12 acceptance test: **NOT STARTED**
- 7-day uninterrupted paper run: **NOT STARTED**
- 14-day run: **NOT STARTED**
- 30+ day run: **NOT STARTED**

## Milestone distinction

`REMOTE PAPER TRADING READY` means the real VPS has passed the remote acceptance checklist.

`STRATEGY VALIDATED` requires later empirical validation and is not implied by an online system.

`LIVE TRADING READY` requires separate evidence/release/security controls and remains disabled.
