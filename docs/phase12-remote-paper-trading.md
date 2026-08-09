# Phase 12 — Remote 24/7 Paper Trading

## Scope

Phase 12 is operational reliability only. It does not validate profitability and it does not enable live order execution.

Production is locked to `PAPER` mode with `REMOTE_PAPER_ONLY=true`. The production API rejects attempts to switch to `LIVE` mode and every existing execution result continues to expose `liveExecutionAllowed: false`.

## What the VPS is for

A VPS is a Linux server that remains online independently of the operator's Windows PC. The Windows PC is used only for administration, SSH access, and optional dashboard viewing. The VPS runs Docker, PostgreSQL, public OKX market-data connections, the strategy, paper execution, persistence, monitoring, and recovery.

Turning off the Windows PC must not stop the production paper-trading runtime. That independence is a real-VPS acceptance requirement and cannot be proven by CI or local Windows testing.

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

A VPS is a Linux server that keeps running in the provider's data center when the operator's Windows PC is shut down. The PC is only used to administer it over SSH and to view the private dashboard through a temporary tunnel. Choose a supported Linux image, configure SSH-key access, retain provider-console access, and expose only SSH in the provider firewall/security group.

The runtime environments are deliberately distinct:

| Environment | Purpose | Execution safety |
| --- | --- | --- |
| Development | Local coding and monitoring | Defaults to paper; the `LIVE` selector is monitoring-only and has no order adapter. |
| Testing | Deterministic unit/integration/simulation fixtures | No exchange orders or private credentials. |
| Production paper trading | Unattended VPS operation | Requires `NODE_ENV=production`, `REMOTE_PAPER_ONLY=true`, and `TRADING_MODE=PAPER`; contradictory/missing safety configuration refuses startup. |
| Live trading | Real private exchange order placement | Not implemented, not configured, and out of scope. |

## Production data locations

Recommended VPS layout:

```text
/opt/okx-whale-detector/
  repo/                         Git checkout and Node project root
  data/
    platform/
      paper-state.json          Phase 11 paper account source records
      trade-contexts.json       per-trade deployment/config traceability
      settings.json             dashboard/strategy settings
  backups/                      daily backups; mode 0700 recommended
  acceptance/                   checksummed VPS acceptance evidence
```

`PLATFORM_DATA_DIR=/opt/okx-whale-detector/data` is bind-mounted to `/app/data`.

Critical paper state is stored outside the Git checkout and outside the replaceable application container. The design is intended to preserve it across container replacement, Docker daemon restart, and VPS reboot; real VPS acceptance tests must still prove those behaviors before `REMOTE PAPER TRADING READY` can be marked PASS.

PostgreSQL uses the persistent Docker volume `okx-paper-production_postgres-data`. Research DB backups are produced with `pg_dump` by the backup script.

## Secrets and OKX permissions

Copy `.env.production.example` to `.env.production` on the VPS and never commit the real file.

Use a URL-safe random PostgreSQL password, for example a hex token generated on the VPS. The Phase 12 runtime uses OKX public market-data REST/WebSocket APIs and does not need an OKX API key, secret, passphrase, or trading permission.

The production preflight fails if `OKX_API_KEY`, `OKX_SECRET`, or `OKX_PASSPHRASE` are present in the environment.

Notification credentials are optional environment variables. They must remain in `.env.production` or the VPS secret mechanism, never source code, Dockerfiles, committed Compose files, logs, or dashboard responses.

## First VPS setup

Install Git, Docker Engine, and the Docker Compose plugin using the current Docker-supported procedure for the selected Linux distribution. Do not use an unreviewed convenience script. Enable Docker at boot, then verify the prerequisites:

```sh
git --version
docker --version
docker compose version
curl --version
sha256sum --version
sudo systemctl enable --now docker
systemctl is-enabled docker
```

Create the deployment directories:

```sh
sudo mkdir -p /opt/okx-whale-detector/{data/platform,backups,acceptance}
sudo chown -R "$USER":"$USER" /opt/okx-whale-detector
```

Clone the repository and enter the project root. The repository was flattened after the original Phase 12 implementation, so the Node project is now the repository root and there is no nested `okx-whale-detector---Copy-main` directory.

```sh
cd /opt/okx-whale-detector
git clone https://github.com/Sanjayfita/okx-whale-detector---Copy-main_3.git repo
cd repo
git switch agent/trading-platform-foundation
```

Before deployment, record the exact checkout without modifying it:

```sh
git branch --show-current
git status --short
git log -1 --oneline
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
- `REMOTE_PAPER_ONLY=true` (never change this on the production VPS)
- deployment metadata values if not using the deployment script overrides

Do not add OKX private trading credentials. Production paper trading uses public market data only and preflight rejects private OKX credentials.

The platform container runs as UID/GID 1000 by default. Prepare the data directory before deployment:

```sh
sudo chown -R 1000:1000 /opt/okx-whale-detector/data
sudo chmod -R u+rwX,go-rwx /opt/okx-whale-detector/data
chmod 700 /opt/okx-whale-detector/backups
chmod 700 /opt/okx-whale-detector/acceptance
```

Run preflight:

```sh
sh ops/preflight-production.sh
```

Preflight verifies Docker/Compose and required host tools, Docker boot enablement, environment-file permissions, matching database configuration, exact `REMOTE_PAPER_ONLY=true`, absence of unnecessary OKX private credentials, persistent-directory ownership/writeability, private dashboard/database Compose bindings, UTC/NTP state where available, and available disk information.

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

On the first deployment only, explicitly authorize creation of the new paper account:

```sh
ALLOW_NEW_PAPER_ACCOUNT=1 sh ops/deploy-production.sh
```

The successful deployment writes a persistent account marker. Every later deployment uses the normal command:

```sh
sh ops/deploy-production.sh
```

If the marker exists but `paper-state.json` is missing, deployment stops. Do not remove the marker or reuse the first-deployment override to hide a missing account; restore the account from a verified backup.

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

Authentication and authorization are therefore provided by the VPS SSH boundary. A network client that is not authenticated to the VPS should not be able to reach the dashboard/API port; this must be verified from an external client during VPS acceptance.

On the VPS, verify the effective binding without printing the resolved Compose configuration, which contains the database password:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml port platform 4173
```

The result must begin with `127.0.0.1:`. From a separate external machine, a direct connection to port 4173 must fail. Through the SSH tunnel, verify that a live-mode change is rejected:

```powershell
curl.exe -i -X PATCH -H "content-type: application/json" -d '{"mode":"LIVE"}' http://127.0.0.1:4173/api/settings
```

The response must be HTTP 400 with `REMOTE_PAPER_ONLY` and `liveExecutionAllowed: false`.

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

The candle WebSocket has heartbeat timeout detection and bounded exponential reconnect backoff.

Phase 12 additionally distinguishes live candle receipt from historical REST replay. If no live candle arrives for the selected timeframe within the health threshold, the platform:

1. marks market data `STALE`;
2. pauses strategy health status;
3. logs/notifies the degradation;
4. force-reconnects the candle WebSocket with a recovery cooldown;
5. lets the reconnect callback trigger history reconciliation;
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
*/5 * * * * cd /opt/okx-whale-detector/repo && sh ops/watchdog.sh 2>&1 | logger -t okx-paper-watchdog
```

A watchdog running on the VPS cannot notify if the entire VPS/provider is offline. For that failure class, use the VPS provider's external monitoring or an external dead-man/heartbeat service. That is an external operational dependency, not something the trading container can truthfully self-detect while powered off.

## Backups

Daily backup command:

```sh
BACKUP_DIR=/opt/okx-whale-detector/backups sh ops/backup-production.sh
```

The backup refuses to run without `paper-state.json`. A completed backup includes:

- `paper-state.json`
- `trade-contexts.json`
- `settings.json`
- the durable paper-account marker
- PostgreSQL `research.dump`
- non-secret deployment manifest
- `checksums.sha256`

`.env.production` is intentionally not copied.

Default retention is 14 days. Override with `BACKUP_RETENTION_DAYS` if required.

Recommended daily cron:

```cron
15 2 * * * cd /opt/okx-whale-detector/repo && BACKUP_DIR=/opt/okx-whale-detector/backups sh ops/backup-production.sh 2>&1 | logger -t okx-paper-backup
```

### Off-server backup

Local daily backups protect against accidental/corrupt state replacement but not total VPS loss. Configure either provider snapshots that include both the Docker volume and `/opt/okx-whale-detector/data`, or an encrypted `rclone` destination such as an S3-compatible service or another controlled server. Keep rclone credentials/configuration outside the repository with owner-only permissions.

After independently verifying encryption and retention, upload one completed backup:

```sh
export OFFSITE_RCLONE_DESTINATION='<configured-remote>:<private-prefix>'
sh ops/upload-offsite-backup.sh /opt/okx-whale-detector/backups/<timestamp>
```

The upload script validates local checksums, refuses environment files, uses immutable/checksum transfer, and runs a remote check. Acceptance remains `NOT CONFIGURED — deployment task remains` until a real remote object survives a download and restore drill on a replacement/test VPS.

Until an off-server destination is configured and a recovery copy is verified, the off-server-backup acceptance item remains `NOT TESTED`/`NOT CONFIGURED`.

## Restore procedure

List backups:

```sh
ls -lah /opt/okx-whale-detector/backups
```

Never test restore against the only production account. First create a separate Compose project, separate host data directory, different loopback dashboard port, and a copy of `.env.production` with those values. Then restore into that controlled copy and capture its account/database evidence. Only an actual disaster should use the production environment file directly.

The restore command for the controlled environment is:

```sh
COMPOSE_PROJECT_NAME=okx-paper-restore-drill \
ENV_FILE=.env.restore-drill RESTORE_RESEARCH_DB=1 SKIP_PRE_RESTORE_BACKUP=1 \
sh ops/restore-production.sh /opt/okx-whale-detector/backups/<timestamp>
```

The restore procedure:

1. verifies backup checksums and rejects secret files;
2. validates JSON before touching current state;
3. creates a safety backup unless explicitly skipped for a fresh drill;
4. stops the selected platform;
5. atomically replaces the state files and preserves UID/GID ownership;
6. optionally restores PostgreSQL with exit-on-error;
7. reruns idempotent migrations and starts the selected platform;
8. waits for operationally ready health with live execution disabled. A strategy paused solely by a restored kill switch/circuit breaker is preserved and accepted; the script never clears risk state to manufacture `RUNNING`.

Research DB restoration is intentionally opt-in:

```sh
RESTORE_RESEARCH_DB=1 sh ops/restore-production.sh /opt/okx-whale-detector/backups/<timestamp>
```

CI runs a checksummed file round trip across account, context, settings, and marker, and separately restores the real custom-format PostgreSQL dump into a disposable database and queries its marker/schema migrations. VPS acceptance must still restore into the controlled Compose project and compare the API account snapshot, trades, risk state, configuration traceability, and research database.

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
RESOURCE_SAMPLE_COUNT=12 RESOURCE_SAMPLE_INTERVAL_SECONDS=300 sh ops/measure-resources.sh
```

The report includes host CPU/RAM/disk, per-container CPU/memory/network/block I/O, paper-data sizes, PostgreSQL database bytes, and Docker storage. Repeated timestamped samples allow growth and recovery peaks to be measured.

Collect several samples during normal operation and during history recovery. Record persistent-state, PostgreSQL, and Docker-storage growth over time. Only then set a minimum/recommended VPS size and optional hard Compose CPU/RAM limits.

Until representative real-VPS measurements exist, resource sizing is `NOT VERIFIED`; do not fabricate CPU/RAM requirements.

## Container crash test

With the platform running:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl -s http://127.0.0.1:4173/api/health
```

Capture the current snapshot/paper state, then kill only the platform process/container:

```sh
ACCEPTANCE_EVIDENCE_DIR=/opt/okx-whale-detector/acceptance sh ops/capture-acceptance-evidence.sh before-container-kill
docker kill "$(docker compose --env-file .env.production -f docker-compose.production.yml ps -q platform)"
```

Because the service uses `restart: unless-stopped`, Docker should restart it automatically.

Verify:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
sh ops/check-production-health.sh
ACCEPTANCE_EVIDENCE_DIR=/opt/okx-whale-detector/acceptance sh ops/capture-acceptance-evidence.sh after-container-kill
```

Confirm positions, trade history, equity, risk state, stops, targets and trailing stop are unchanged except for legitimate new market marks/events after restart. Record timestamps/logs and confirm that no historical recovery candle generated a retroactive paper trade.

This test is `NOT TESTED` until performed on the real VPS.

## VPS reboot test

Do this only after SSH access and provider console access are confirmed.

Before reboot:

```sh
sh ops/check-production-health.sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
ACCEPTANCE_EVIDENCE_DIR=/opt/okx-whale-detector/acceptance sh ops/capture-acceptance-evidence.sh before-reboot
```

Record paper balance/equity, positions, trade count, latest confirmed candle, latest trade, risk state, Git/image/config identity and relevant file checksums before reboot.

Then:

```sh
sudo reboot
```

After the server is reachable again:

```sh
cd /opt/okx-whale-detector/repo
docker compose --env-file .env.production -f docker-compose.production.yml ps
sh ops/check-production-health.sh
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 platform
ACCEPTANCE_EVIDENCE_DIR=/opt/okx-whale-detector/acceptance sh ops/capture-acceptance-evidence.sh after-reboot
```

Evidence must show Docker started, the platform container started automatically, paper reconciliation ran, missing candles were recovered, OKX reconnected, and the paper account remained intact with no duplicate execution.

This test is mandatory and remains `NOT TESTED` until performed on the real VPS.

## Network failure test

Prefer doing this while the strategy is on a short timeframe so stale detection can be observed without waiting hours.

Record evidence first. If the provider offers a controlled application-network fault, prefer it. Otherwise, and only while provider-console access is confirmed, disconnect the platform container (not the host/VPS network) from its Compose network. Record both values before disconnecting so the exact reconnect command is ready. Do not alter the SSH interface, host route, or VPS firewall.

```sh
sh ops/capture-acceptance-evidence.sh before-network-test
platform_id="$(docker compose --env-file .env.production -f docker-compose.production.yml ps -q platform)"
network_name="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$platform_id")"
docker network disconnect "$network_name" "$platform_id"
# Wait long enough to exceed the selected timeframe's stale threshold, then:
docker network connect "$network_name" "$platform_id"
```

After reconnecting the network, verify logs show WebSocket reconnect and candle history reconciliation, then verify:

- market data becomes stale and strategy health pauses while disconnected;
- no stale-data paper entry is created;
- no duplicate paper trades;
- no duplicate fills;
- no duplicate funding;
- risk state did not reset;
- no retroactive historical trades;
- health returned from `DEGRADED` to `RUNNING`.

After reconnect, run `sh ops/check-production-health.sh` and capture `after-network-test`. If the exact reconnect command or console fallback is not available, do not run this test; mark it `BLOCKED` rather than risking VPS access.

Phase 11 idempotency tests remain the deterministic duplicate-event proof; this remote test adds operational evidence around the real container/network lifecycle.

This test remains `NOT TESTED` until performed safely on the real VPS.

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

Before replacing the platform, rollback creates a backup when paper state exists. It also recovers the Git commit baked into the selected Docker image and injects that identity into the rolled-back container. If the selected image does not contain trustworthy Git identity metadata, rollback fails closed instead of recording future paper trades against an incorrect commit.

If a future release contains a non-backward-compatible database/state migration, it must define its own rollback/migration policy. Phase 12 does not introduce a DB schema migration.

Capture evidence before the update, after the update, and after rollback. Compare paper balance, positions, trade/fill/funding counts, risk state, and configuration fingerprints. Older images without the OCI Git-revision label require an explicitly verified `ROLLBACK_GIT_COMMIT`; never guess it.

## Safe shutdown

Capture evidence and create a verified backup first. Stop the paper application so its graceful shutdown writes a final checkpoint, then stop the database:

```sh
sh ops/capture-acceptance-evidence.sh before-safe-shutdown
BACKUP_DIR=/opt/okx-whale-detector/backups sh ops/backup-production.sh
docker compose --env-file .env.production -f docker-compose.production.yml stop platform
docker compose --env-file .env.production -f docker-compose.production.yml stop database
```

To recreate containers while preserving state, `docker compose down` without `--volumes` is permitted after a backup. Never run `docker compose down --volumes`, never remove `postgres-data`, and never delete the host data directory during normal shutdown, update, or rollback.

## Acceptance records

`ops/capture-acceptance-evidence.sh <label>` records host/OS/Docker/Git/image identity, Compose state, health, account snapshot, recent logs, resource use, disk, and state checksums. It deliberately does not record `.env.production` or container environment values. Store these records outside Git and copy them to controlled off-server evidence storage.

Use [the Phase 12 acceptance matrix](phase12-acceptance-matrix.md) as the source of truth. A script exit code or green CI run is repository evidence, not VPS acceptance.

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

## Production image validation

Repository CI must do more than parse `docker-compose.production.yml`. It builds the actual production `platform` image and verifies that the requested Git commit is baked into the image metadata used by rollback traceability.

A successful image build is repository evidence only. It is not proof that the image has survived a real VPS restart, reboot, network interruption, or long unattended run.

## Shutdown

For a planned maintenance stop, create a backup first and then stop the Compose application deliberately:

```sh
BACKUP_DIR=/opt/okx-whale-detector/backups sh ops/backup-production.sh
docker compose --env-file .env.production -f docker-compose.production.yml stop platform
```

Do not delete `/opt/okx-whale-detector/data`, the PostgreSQL volume, or backup directories as part of a normal stop/update. Do not use `docker compose down -v` on the production project because `-v` removes named volumes, including PostgreSQL persistence.

## What not to do

- Do not add OKX private trading credentials to production paper trading.
- Do not expose TCP 4173 publicly.
- Do not publish PostgreSQL port 5432 from production Compose.
- Do not set `REMOTE_PAPER_ONLY=false` in production.
- Do not use `docker compose down -v` against the production project.
- Do not delete `/opt/okx-whale-detector/data` during deploy/rollback.
- Do not restore destructively over the only production account merely to prove restore.
- Do not call CI success, a running container, or paper profit proof of live-trading readiness.

To verify the paper-only boundary after deployment, confirm `/api/health` reports `liveExecutionAllowed: false` and verify that a dashboard/API request to switch mode to `LIVE` is rejected with `REMOTE_PAPER_ONLY`.

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
13. isolated backup restore test including PostgreSQL evidence;
14. rollback test with identity/account preservation;
15. resource measurement;
16. secure SSH-tunnel dashboard access and negative public-reachability check;
17. Windows PC offline while the VPS continues operating independently.

Repository/CI readiness and real VPS acceptance are separate milestones.

## Acceptance matrix — current repository-side evidence

The table below is deliberately conservative. `PASS` means the repository/configuration has direct evidence for that item; lifecycle items that can only be proven on a real server remain `NOT TESTED` even when code/tests exist.

| Requirement | Status | Evidence / remaining boundary |
| --- | --- | --- |
| Production image | PARTIAL | CI builds the image; real VPS deployment not tested |
| Paper-only enforcement | PASS | Compose forces PAPER/REMOTE_PAPER_ONLY and API rejects LIVE |
| Persistent state | PARTIAL | code/tests pass; real container/VPS lifecycle not tested |
| PostgreSQL persistence | PARTIAL | named volume configured; real VPS reboot/restore not tested |
| Private PostgreSQL | PARTIAL | no production host port; external VPS reachability not tested |
| Private dashboard | PARTIAL | loopback host binding configured; SSH tunnel/public negative test not run |
| Health endpoint | PASS | detailed health implemented/tested; real VPS observations pending |
| Stale candle detection | PARTIAL | implemented/tested; controlled real outage not run |
| WebSocket reconnect | PARTIAL | heartbeat/backoff implemented/tested; real outage not run |
| REST recovery | PARTIAL | bounded retry/backfill implemented/tested; real outage not run |
| Duplicate protection | PASS | fill/funding/candle restart idempotency tests exist |
| Risk-state recovery | PASS | persisted/reconciled in tests |
| Backup | PARTIAL | tooling/file round trip exists; real production backup not created |
| Restore | PARTIAL | checksummed file round trip plus disposable PostgreSQL dump/restore in CI; isolated real account + DB restore still required |
| Rollback | PARTIAL | state-preserving/identity-safe tooling present; real rollback not run |
| Container restart | NOT TESTED | requires real VPS |
| VPS reboot | NOT TESTED | requires real VPS |
| Network recovery | NOT TESTED | requires real VPS |
| Disk monitoring | PARTIAL | health/watchdog implemented; threshold behavior on VPS not tested |
| Log rotation | PARTIAL | Docker config bounded; real VPS log behavior not observed |
| Off-server backup | NOT TESTED | external destination not configured |
| Resource measurements | NOT TESTED | requires representative real deployment measurements |
| 7-day unattended run | NOT TESTED | elapsed-time requirement |
| 14-day unattended run | NOT TESTED | elapsed-time requirement |
| 30-day unattended run | NOT TESTED | elapsed-time requirement |
| Strategy validation | NOT TESTED | separate empirical phase |
| Live trading | NOT APPLICABLE | MUST REMAIN DISABLED |

## Gap status after repository implementation

### Infrastructure

- remote deployment tooling: **REPOSITORY VERIFIED; VPS execution NOT STARTED**
- monitoring: **IMPLEMENTED; VPS watchdog/alert delivery NOT TESTED**
- alerts: **IMPLEMENTED; no real notification or external host-down monitor configured**
- backups: **LOCAL SYNTHETIC ROUND TRIP PASS; real VPS and off-server backups NOT CONFIGURED**
- log rotation: **CONFIGURED; Docker runtime evidence NOT TESTED**
- authentication: **SSH/loopback design verified; VPS SSH/firewall evidence NOT TESTED**
- health checks: **IMPLEMENTATION/TESTS PASS; production response NOT CAPTURED**
- automatic process/container recovery: **CONFIGURED; kill/reboot tests NOT STARTED**
- actual server-reboot evidence: **NOT STARTED**

### Trading-data correctness

- real OKX funding settlement ingestion: **BLOCKED** pending verified settlement-time mark/notional evidence
- candle synchronization/restart recovery: **REPOSITORY TESTS PASS; VPS NOT TESTED**
- WebSocket heartbeat/reconnect: **REPOSITORY TESTS PASS; VPS NOT TESTED**
- stale-stream detection/recovery: **REPOSITORY TESTS PASS; VPS NOT TESTED**
- temporary REST retry/backoff: **REPOSITORY TESTS PASS; VPS NOT TESTED**
- slippage modeling: **IMPLEMENTED in existing execution simulator; strategy validity separate**
- spread modeling: **IMPLEMENTED in existing execution simulator; strategy validity separate**
- latency modeling: **IMPLEMENTED in existing execution simulator; strategy validity separate**

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

`REPOSITORY READY` means code/deployment tooling is prepared and repository checks pass. It does not imply server acceptance.

`REMOTE PAPER TRADING READY` means the real VPS has passed deployment, failure-recovery, restore/rollback, secure-access and independence checks.

`STRATEGY VALIDATED` requires later empirical validation and is not implied by an online system.

`LIVE TRADING READY` requires separate evidence/release/security controls and remains disabled.
