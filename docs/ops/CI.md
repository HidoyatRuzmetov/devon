# CI execution and release safety

The `CI` workflow runs four independent jobs against the same checked-out commit:

| Job                                                    | Checks                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source, unit, migration and security                   | Every configured integration/release profile gate except `e2e` and `a11y`, plus deployment/backup/CI guard tests                                                     |
| Development browser journeys and accessibility         | The existing `e2e` and `a11y` gates, including Vite-only fixtures                                                                                                    |
| Compiled production browser journeys and accessibility | A fresh production React build, then both compiled browser suites with one worker and zero retries                                                                   |
| Everyday workflow and real upload scanning             | A separate fresh production build and the worker, structure, board navigation, invitation/password, department decision, real ClamAV and avatar interaction journeys |

Each job has an isolated runner, checkout, local test database and service processes. Parallel jobs do not share test accounts, ports, report files or built outputs. The pinned pnpm dependency-store cache remains enabled; every job still installs the frozen lockfile. Browsers and security scanners are installed only by jobs that use them. Security findings and vulnerability databases are not restored from result caches.

`scripts/ci-gate.mjs` partitions the current `agentic/gates.json` profile dynamically. Newly configured gates join the source job automatically. Gate order within each partition, commands, blocking policy, thresholds and release-only performance/dependency checks remain unchanged. Development and production browser verification both remain required.

The stable required check names, `gate (integration profile)` and `gate (release profile)`, are final aggregators. They run even after an upstream failure and accept only all four successful dependencies. Missing, failed, cancelled or skipped dependencies fail the final check. Reports use distinct artifact names for each partition.

Production deployment still requires a successful push-triggered `CI` run for the exact current `main` commit. It rechecks current `main` before transferring manifests. Immutable image tags, fresh production-image vulnerability scans, verified database backup, migrations, readiness checks and image/manifest rollback remain unchanged.

## Measured serial baseline

The successful main run [38238172595](https://github.com/HidoyatRuzmetov/devon/actions/runs/38238172595), commit `3c5feb69fc48ec823a311b87ee1359e49d10f2b0`, used one runner from 10:44:09 to 11:10:42 UTC on 12 October 2026: **26 minutes 33 seconds**. Its logs show:

| Work                                                            | Duration |
| --------------------------------------------------------------- | -------: |
| Compiled production journeys and accessibility, including build |   6m 30s |
| Dedicated workflow/scanner regressions                          |   4m 05s |
| Integration gate profile                                        |  13m 55s |
| Within that profile: workspace unit tests                       |   4m 09s |
| Within that profile: development E2E and accessibility          |   6m 45s |

The successful follow-up [deployment 38240989972](https://github.com/HidoyatRuzmetov/devon/actions/runs/38240989972) took **4 minutes 05 seconds**. End-to-end CI plus deployment was about 30 minutes 48 seconds, excluding queue time. The major cost was serial execution of independent checks, rather than downloading dependencies.

Parallel execution should make CI's wall time follow its slowest job rather than the sum of all jobs. An initial estimate from these measurements is about 8–10 minutes for CI on comparable available runners, plus deployment; it is an estimate, not a measured result. Runner queuing, new tests and changing scanner databases can increase it. Update this document with the first completed parallel-run measurements before claiming a measured speedup. Parallel execution uses more simultaneous runners and can increase aggregate setup minutes.
