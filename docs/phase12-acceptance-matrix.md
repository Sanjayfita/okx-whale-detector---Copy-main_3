# Phase 12 acceptance matrix

Last repository update: 2026-08-09

Milestone status:

- `REPOSITORY READY`: **PARTIAL** — Node/static/synthetic checks pass, but the production image/stack and disposable PostgreSQL restore were not executable without a Docker daemon.
- `REMOTE PAPER TRADING READY`: **NO** — no real Linux VPS evidence exists.
- `STRATEGY VALIDATED`: **NO** — infrastructure operation does not prove profitability.
- Live trading: **MUST REMAIN DISABLED**.

Statuses describe the strongest evidence currently available. A repository or unit-test result is not promoted to VPS `PASS`.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Production image | NOT TESTED | Dockerfile exists; local Docker daemon unavailable and no VPS build record exists. |
| Paper-only enforcement | PARTIAL | Compose constant, production fail-closed startup resolver, API rejection, no private execution adapter; local tests pass, but VPS response still needs recording. |
| Persistent state | PARTIAL | Bind mount plus atomic state repository and restart tests; no container/reboot evidence. |
| PostgreSQL persistence | PARTIAL | Named volume and disposable dump/restore CI tooling; no VPS replacement/reboot evidence. |
| Private PostgreSQL | PARTIAL | No published Compose port; VPS socket/firewall scan not performed. |
| Private dashboard | PARTIAL | Loopback-only Compose binding and SSH tunnel design; external reachability test not performed. |
| Health endpoint | PARTIAL | Multi-component implementation/tests exist; real production health not captured. |
| Stale candle detection | PARTIAL | Deterministic implementation/tests; real outage not performed. |
| WebSocket reconnect | PARTIAL | Heartbeat/backoff lifecycle tests; real VPS reconnect not performed. |
| REST recovery | PARTIAL | Confirmed-only bounded retry/page recovery tests; real outage recovery not performed. |
| Duplicate protection | PARTIAL | Candle/fill/funding/account idempotency tests; real failure injection not performed. |
| Risk-state recovery | PARTIAL | Tests cover risk and position state; VPS restart not performed. |
| Backup | PARTIAL | Atomic checksummed script; synthetic account/context/settings/marker round trip passed locally; no real production backup artifact. |
| Restore | PARTIAL | File and disposable database verification tooling; no controlled VPS restore comparison. |
| Rollback | NOT TESTED | State-preserving script and image identity checks exist; no controlled two-version VPS rollback. |
| Container restart | NOT TESTED | Restart policy configured; kill/restart acceptance absent. |
| VPS reboot | NOT TESTED | Requires real VPS. |
| Network recovery | NOT TESTED | Requires a safe real-VPS/provider test. |
| Disk monitoring | PARTIAL | Application and watchdog thresholds implemented; VPS threshold/alert evidence absent. |
| Log rotation | PARTIAL | Compose limits each service to five 10 MiB JSON logs; Docker runtime evidence absent. |
| Off-server backup | BLOCKED | `NOT CONFIGURED — deployment task remains`; destination, encryption, upload, download, and total-loss restore evidence required. |
| Resource measurements | BLOCKED | Resource sizing requires real deployment measurements. No minimum/recommended VPS size is asserted. |
| 7-day unattended run | NOT TESTED | Actual elapsed Windows-off run required. |
| 14-day unattended run | NOT TESTED | Actual elapsed Windows-off run required. |
| 30-day unattended run | NOT TESTED | Actual elapsed Windows-off run required. |
| Strategy validation | NOT TESTED | Separate out-of-sample/walk-forward/cost/slippage/Monte Carlo/holdout work. |
| Live trading | PASS — MUST REMAIN DISABLED | Production is paper-only and contains no private OKX order execution path; verify again on VPS. |

## Evidence required to change VPS rows to PASS

Record the VPS hostname, OS, Docker/Compose versions, Git SHA, image/configuration identity, timestamps, checksummed pre/post acceptance captures, backup filename/size/checksum, controlled restore comparison, and relevant logs. Do not record credentials. Each failure test must compare account balance, positions, trades, fills, funding, risk state, latest candle, and configuration fingerprint before and after.

## Repository validation recorded on 2026-08-09

- `npm ci`: PASS.
- TypeScript backend/dashboard typecheck: PASS.
- ESLint: PASS.
- Focused Phase 12 safety/recovery tests: PASS, 22/22.
- Complete test suite: PASS, 1,748/1,748. An earlier concurrent run hit one five-second timeout; the test passed alone and the uncontended full rerun passed.
- Backend/dashboard production build: PASS.
- Development and production Compose parse: PASS.
- Resolved production Compose assertions (paper-only, loopback dashboard, no PostgreSQL port): PASS.
- POSIX shell syntax for every operations script: PASS through Git for Windows shell.
- Checksummed file backup/restore round trip: PASS through Git for Windows shell.
- Production dependency audit: PASS, zero vulnerabilities. The development-only toolchain reports 15 high advisories with no normal audit fix; it is excluded from the runtime image.
- Repository-wide Prettier check: FAIL at the inherited baseline (786 files), not used by CI; unrelated files were not mechanically rewritten.
- Docker image build/start and disposable PostgreSQL restore: NOT TESTED locally because no Docker daemon is running.
