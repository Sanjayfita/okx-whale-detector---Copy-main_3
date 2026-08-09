# Phase 12 repository audit

Audit date: 2026-08-09

This is a repository and local-host audit. It is not evidence of a Linux VPS deployment. Missing operational evidence is deliberately marked `NOT VERIFIED` rather than inferred from source code or CI.

## Git baseline

| Item | Classification | Evidence |
| --- | --- | --- |
| Branch | VERIFIED | `agent/trading-platform-foundation` |
| Audit starting commit | VERIFIED | `d3cbc18c34c536571af67dac2db96333c13f566d` (`chore(repo): remove one-shot flatten workflow`) |
| Starting working tree | VERIFIED | Clean (`git status --porcelain=v2` produced no entries) |
| Reported Phase 12 commit | PARTIALLY VERIFIED | The supplied full SHA `9f5cc2c292423ab6265ea97ab252fbdd4c9e85c1` does not exist. The ancestor with the reported short ID and message is `9f5cc2c292423ab6265ea97ab252fbdd9c4e85c1`, `test(ops): assert trace gate through account snapshot`. |
| Phase 12 implementation | VERIFIED | Production Compose, environment example, all eight reported operations scripts, runtime supervision/recovery code, tests, CI checks, and the Phase 12 runbook are present in history and the current checkout. |
| Preserved local artifacts | RISK | The ignored legacy directory `okx-whale-detector---Copy-main/` contains generated output, dependencies, and local paper evidence. It was not modified or deleted. It is not part of a fresh clone. |

## Safety and runtime audit

| Requirement | Classification | Repository evidence and boundary |
| --- | --- | --- |
| Production is paper-only | PARTIALLY VERIFIED / BUG | Production Compose sets `TRADING_MODE=PAPER` and `REMOTE_PAPER_ONLY=true`; the production server rejects API changes to `LIVE`; no OKX private trading endpoint or credential use was found. However, `startTradingPlatform` does not require `REMOTE_PAPER_ONLY=true` when `NODE_ENV=production`, so a future Compose/image invocation can lose the production guard instead of failing closed. |
| No private OKX credentials required | VERIFIED | Only public OKX REST and public/business market-data WebSockets are used. Preflight rejects exported `OKX_API_KEY`, `OKX_SECRET`, and `OKX_PASSPHRASE`. No private order endpoint was found. |
| Dashboard is private | PARTIALLY VERIFIED | Production publishes `127.0.0.1:${DASHBOARD_PORT}:4173`, and the documented access model is an SSH tunnel. Actual firewall/security-group and external reachability require a VPS. |
| PostgreSQL is private | PARTIALLY VERIFIED | The production database service has no published host port and uses the private Compose network. Actual listening sockets/firewall require a VPS. |
| PostgreSQL persistence | PARTIALLY VERIFIED | The database uses the named `postgres-data` volume and migrations are written to be rerunnable. Container replacement/reboot and real dump/restore are not locally proven. |
| Application/database connectivity | PARTIALLY VERIFIED | Compose gates migrations on `pg_isready`, and deployment runs migrations before the platform. The paper platform itself does not consume `DATABASE_URL` or report database health; the database currently stores research schema/evidence rather than the file-backed paper account. |
| Paper state survives replacement | PARTIALLY VERIFIED | `/app/data` is a host bind mount; paper state, settings, and trade contexts are outside the image. Atomic state writes and in-process restart restoration are covered by tests. Container replacement and reboot remain VPS tests. |
| Restart policy | VERIFIED (configuration) | Database and platform use `restart: unless-stopped`; migrations use `restart: "no"`. Automatic recovery is not accepted until kill and reboot tests run on Linux. |
| Health is more than liveness | VERIFIED (implementation) | `/api/health` reports REST, WebSocket, candle freshness, strategy state, risk controls, paper engine, persistence, disk, and deployment identity. `FAILED` returns 503; recoverable `DEGRADED` returns 200 to avoid restart loops and is separately detected by the watchdog. |
| Stale market data pauses entries | VERIFIED (implementation) | Stale candle state makes strategy health `PAUSED`; new entries are candle-driven, and no candle means no entry evaluation. Forced reconnect is cooldown-bounded. Actual outage behavior requires a VPS. |
| WebSocket reconnect | VERIFIED (implementation) | Heartbeat timeout and exponential reconnect delay are bounded at 30 seconds. Actual public-network recovery remains a VPS test. |
| REST candle recovery | VERIFIED (implementation) | Reconnect triggers confirmed-only, chronological, deduplicated REST history recovery with bounded page count and retry/backoff. |
| No retroactive recovery trades | VERIFIED (implementation/tests) | Timeframe rebuild sets an execution barrier; historical candles populate indicators while execution is disabled, and execution resumes only beyond the last historical timestamp. |
| Duplicate event/trade protection | VERIFIED (implementation/tests) | Candle history is timestamp-deduplicated; paper fill, funding, account events, and trade IDs are idempotent and restored across restart. Real failure injection remains a VPS acceptance item. |
| Risk state survives restart | VERIFIED (implementation/tests) | Kill switch, circuit breaker, consecutive losses, cooldown, realized loss, daily trade count, positions, stops, targets, and trailing state are serialized and restored. |
| Per-trade version/config traceability | VERIFIED (implementation/tests) | A trade context is durably recorded before entry; context-write failure activates the kill switch and blocks the paper entry. Git/image/config identity and the strategy fingerprint are recorded. |
| Backup contains necessary evidence | PARTIALLY VERIFIED / BUG | The script copies paper state, trade contexts, settings, research dump, and a non-secret manifest. It can nevertheless report success when critical paper files are absent, has no integrity checksum, and leaves real DB restore unproved. |
| Restore is usable | PARTIALLY VERIFIED / BUG | JSON is validated and restored through sibling temporary files, and a synthetic file round trip exists. The test does not verify settings, manifest integrity, checksums, or PostgreSQL restore; a production restore also prints “verified” after health only, without comparing account evidence. |
| Rollback preserves state | PARTIALLY VERIFIED / RISK | Rollback selects an existing versioned image and never removes the bind mount or DB volume. It is not Linux-tested, and its deployment identity can retain a Git SHA inconsistent with the selected rollback image. |
| Secrets excluded | VERIFIED (repository) | `.env.production`, backups, and data are ignored; `.dockerignore` excludes `.env*`, data, artifacts, logs, and Git metadata; backup does not copy the environment file. External backup configuration still needs its own secret-handling proof. |
| Logs bounded | VERIFIED (configuration) | Every production service uses `json-file` rotation at five 10 MiB files. Runtime behavior requires Docker validation. |
| Disk exhaustion detected | VERIFIED (implementation) | Application health becomes `LOW` below 1 GiB or 10% free; watchdog alerts at 90% used. Alert delivery and threshold behavior require VPS evidence. |
| Independent of Windows/VS Code | VERIFIED (design) / NOT VERIFIED (operation) | Runtime and operations use Linux, Docker Compose, POSIX shell, Git, and cron. No Windows process is required. A real unattended VPS run is still absent. |

## Operations and documentation audit

| Item | Classification | Finding |
| --- | --- | --- |
| Production image build | NOT VERIFIED | Docker client and Compose are installed locally, but the Docker daemon is not running. |
| Production Compose parse | LOCALLY TESTABLE | Can be validated without a daemon using the example environment. It is not proof that containers start. |
| Linux shell scripts | PARTIALLY VERIFIED | CI declares syntax checks and a synthetic file restore test. This Windows host cannot execute WSL/bash. |
| Preflight idempotence | PARTIALLY VERIFIED | Safe to rerun, but it does not verify Git/curl availability, exact container UID/GID write access, environment-file permissions, loopback publication, or fail-closed production mode. |
| Deploy idempotence | PARTIALLY VERIFIED | It backs up an existing state, stamps the checked-out Git SHA, reruns idempotent migrations, and recreates the platform without deleting state. Real rerun behavior is untested. |
| New-account initialization | BUG | The starting deployment flow automatically created a fresh account whenever `paper-state.json` was absent. A wrong/empty host path could therefore look like an intentional first deployment. A one-time explicit authorization and durable account marker are required. |
| Backup retention | RISK | Local retention deletes old dated backup directories as designed. There is no off-server upload, and no integrity check precedes retention. |
| Off-server backup | MISSING | No destination, encryption, upload, or restore-from-total-loss procedure is configured. Status: **NOT CONFIGURED — deployment task remains.** |
| Resource sizing | REQUIRES REAL VPS | `measure-resources.sh` takes a point-in-time host/container/data snapshot but no representative samples or growth measurements exist. Resource sizing requires real deployment measurements. |
| Fresh-clone instructions | BUG | The repository was flattened after the Phase 12 runbook was written. The runbook still changes into a removed nested project directory in clone, cron, and reboot examples, so a fresh VPS operator would fail or target stale local artifacts. |
| Acceptance evidence capture | MISSING | Failure tests are described manually, but there is no structured evidence directory/manifest or pre/post snapshot comparison tooling. |
| Acceptance matrix | MISSING | The runbook has prose gap lists but not the required PASS/FAIL/PARTIAL/NOT TESTED/BLOCKED matrix. |
| Safe shutdown and update detail | PARTIALLY VERIFIED | Update/rollback are documented, but a complete operator shutdown procedure and explicit evidence-preserving acceptance workflow are missing. |

## Local-host constraints observed

- Node.js is available (`v24.18.0`). PowerShell policy blocks `npm.ps1`, so validation must use `npm.cmd`.
- Docker CLI `29.6.2` and Docker Compose `v5.3.1` are installed, but the Docker daemon is not running.
- WSL/bash execution is denied on this host.
- Therefore Docker build/start, PostgreSQL connectivity, migrations in containers, live OKX container operation, Linux shell execution, container restart, network interruption, and reboot cannot be accepted locally.

## Required repository fixes before VPS deployment

1. Make production paper-only startup fail closed inside the application, not only in Compose.
2. Harden preflight around required tools, file permissions, UID/GID writeability, private bindings, and immutable paper-only Compose configuration.
3. Make backups fail on missing core evidence, add checksums/integrity verification, and strengthen the file round-trip test without claiming database restore.
4. Correct rollback identity and add evidence-preserving health/account checks.
5. Correct all post-flatten VPS paths.
6. Add reproducible acceptance evidence tooling and the required acceptance matrix.
7. Document an optional provider-neutral encrypted off-server backup flow, while leaving it `NOT CONFIGURED` until real credentials/destination and restore evidence exist.

## Boundary after repository work

The highest honest repository-only milestone is `REPOSITORY READY`. `REMOTE PAPER TRADING READY` still requires a real Linux VPS, provider-console-safe failure tests, secure SSH/firewall configuration, an off-server backup destination, resource measurements, and elapsed unattended runs. `STRATEGY VALIDATED` is separate and remains out of scope. Live trading must remain disabled.
