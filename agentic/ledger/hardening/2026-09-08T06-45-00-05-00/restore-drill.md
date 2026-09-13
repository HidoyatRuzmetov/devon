# Restore drill -- 20260913T070421Z

**Qisqacha (uz-Latn):** Eng so'nggi zaxira nusxasi vaqtinchalik ma'lumotlar bazasiga tiklandi, migratsiyalar va qatorlar soni solishtirildi, MinIO nusxasi vaqtinchalik bucketga qaytarildi. Natija: **PASS**.

**Verdict: PASS** -- 8 passed, 0 failed, 0 skipped.

| Field | Value |
|---|---|
| Backup file | `devon-devon-20260913T065843Z.dump` (2.3 MiB) |
| Source database | `devon` on `postgres` (docker network `devon`) |
| Scratch database | `devon_drill_20260913t070421z` (dropped after the drill) |
| Postgres image | `pgvector/pgvector:0.8.6-pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f` |
| Restore duration | 6s |
| Manifest | `devon-devon-20260913T065843Z.dump.manifest.json` |
| Command | `node tools/backup/restore-drill.mjs --report agentic/ledger/hardening/2026-09-08T06-45-00-05-00/restore-drill.md` |

## Checks

| Check | Result | Detail |
|---|---|---|
| pg_restore into the scratch database exits cleanly | PASS | 6s |
| restored database lists every migration in packages/db/migrations | PASS | 35/35 present |
| row-level-security policies survive the restore (I-1) | PASS | 97 restored vs 97 live |
| every table restores with the row count recorded at dump time | PASS | 85 tables compared |
| pnpm --filter @devon/db migrate:verify | PASS | all sections pass |
| MinIO backup mirror bucket "devon-backups" restores into a scratch bucket | PASS | 2 object(s), 2.3 MiB, byte-for-byte identical in devon-drill-20260913t070421z-devon-backups |
| the backup being drilled is present in the off-host mirror at the same size | PASS | devon-devon-20260913T065843Z.dump 2.3 MiB (local 2.3 MiB) |
| MinIO application object store bucket "devon" restores into a scratch bucket | PASS | 3 object(s), 2.5 KiB, byte-for-byte identical in devon-drill-20260913t070421z-devon |

## Migrations in the restored database (`app._migrations`)

35/35 migration files from `packages/db/migrations/` are recorded as applied in the restored database.

## `pnpm --filter @devon/db migrate:verify`

This is the repository's own `migrate` gate. It starts its OWN Testcontainers Postgres -- it cannot be pointed at the restored database -- so it proves the migration set is internally consistent, idempotent and keeps RLS/audit immutability intact; the restored bytes are checked by the `app._migrations` and row-count sections above.

Exit code: 0

```
  PASS  devon_app can SELECT from audit.events
  PASS  devon_app UPDATE on audit.events is denied
  PASS  devon_app DELETE on audit.events is denied
  PASS  devon_app TRUNCATE on audit.events is denied
  PASS  500 concurrent inserts all succeed (advisory-lock-serialised chain) (inserted=500)
  PASS  audit.verify_chain() reports ok after the concurrent build ({"ok":true,"firstBadSeq":null,"failure":null,"rowsChecked":501})
  PASS  audit.verify_chain() reports exactly the tampered seq after an out-of-band UPDATE ({"ok":false,"firstBadSeq":2,"failure":"row_hash_mismatch","rowsChecked":1,"expectedSeq":2})
[poll-votes.race] 2 checks:
  PASS  20 concurrent re-votes from the same voter leave exactly one row (no deadlock, no duplicate) (final row count for this voter: 1 (expected 1))
  PASS  20 different voters concurrently voting the same option all land (no lost votes) (final vote count for this option: 20 (expected 20))
[migrate:verify] 779/779 checks passed across 7 sections.
[migrate:verify] PASS
```

## Row counts

`Expected` is the count `infra/backup/backup.sh` recorded in the manifest immediately before `pg_dump` ran. `Restored` is the count in the scratch database. `Live now` is the current live database, shown only as drift context -- a live count ahead of expected is normal on an append-only, still-running system and is never a drill failure.

| Table | Expected (at dump time) | Restored | Live now |
|---|---:|---:|---:|
| `app._migrations` | 35 | 35 | 35 |
| `app.account_deletion_requests` | 0 | 0 | 0 |
| `app.ai_department_settings` | 1 | 1 | 1 |
| `app.ai_search_documents` | 364 | 364 | 364 |
| `app.ai_traces` | 24 | 24 | 24 |
| `app.analytics_daily` | 95 | 95 | 95 |
| `app.analytics_pinned_charts` | 3 | 3 | 3 |
| `app.analytics_saved_filters` | 2 | 2 | 2 |
| `app.attachments` | 0 | 0 | 0 |
| `app.automation_rules` | 3 | 3 | 3 |
| `app.automation_runs` | 79 | 79 | 79 |
| `app.calendar_feeds` | 1 | 1 | 1 |
| `app.card_activity` | 431 | 431 | 431 |
| `app.card_checklist_items` | 302 | 302 | 302 |
| `app.card_comments` | 82 | 82 | 82 |
| `app.card_dependencies` | 2 | 2 | 2 |
| `app.card_reminders` | 2 | 2 | 2 |
| `app.card_time_logs` | 3 | 3 | 3 |
| `app.cards` | 272 | 272 | 272 |
| `app.carpool_seats` | 1 | 1 | 1 |
| `app.carpools` | 1 | 1 | 1 |
| `app.department_requests` | 4 | 4 | 4 |
| `app.departments` | 10 | 10 | 10 |
| `app.event_comments` | 3 | 3 | 3 |
| `app.event_feedback` | 2 | 2 | 2 |
| `app.event_items` | 2 | 2 | 2 |
| `app.event_photos` | 2 | 2 | 2 |
| `app.event_reminder_jobs` | 0 | 0 | 0 |
| `app.event_rsvps` | 18 | 18 | 18 |
| `app.events` | 5 | 5 | 5 |
| `app.field_defs` | 4 | 4 | 4 |
| `app.field_requests` | 28 | 28 | 28 |
| `app.field_values` | 25 | 25 | 25 |
| `app.focus_pins` | 4 | 4 | 4 |
| `app.goals` | 3 | 3 | 3 |
| `app.idempotency_keys` | 0 | 0 | 0 |
| `app.instance_settings` | 1 | 1 | 1 |
| `app.join_attempts` | 1 | 1 | 1 |
| `app.labels` | 5 | 5 | 5 |
| `app.login_challenges` | 0 | 0 | 0 |
| `app.memberships` | 63 | 63 | 63 |
| `app.notification_deliveries` | 54 | 54 | 55 |
| `app.notification_department_settings` | 1 | 1 | 1 |
| `app.notification_prefs` | 18 | 18 | 18 |
| `app.notification_quiet_hours` | 1 | 1 | 1 |
| `app.notifications` | 52 | 52 | 52 |
| `app.onboarding_runs` | 0 | 0 | 0 |
| `app.onboarding_templates` | 1 | 1 | 1 |
| `app.outbox_events` | 11636 | 11636 | 11636 |
| `app.page_versions` | 7 | 7 | 7 |
| `app.pages` | 7 | 7 | 7 |
| `app.people_views` | 0 | 0 | 0 |
| `app.personal_canvases` | 2 | 2 | 2 |
| `app.personal_notes` | 4 | 4 | 4 |
| `app.personal_sprints` | 4 | 4 | 4 |
| `app.personal_tasks` | 14 | 14 | 14 |
| `app.poll_options` | 2 | 2 | 2 |
| `app.poll_votes` | 2 | 2 | 2 |
| `app.polls` | 1 | 1 | 1 |
| `app.pomodoro_sessions` | 26 | 26 | 26 |
| `app.pomodoro_settings` | 2 | 2 | 2 |
| `app.projects` | 6 | 6 | 6 |
| `app.push_subscriptions` | 0 | 0 | 0 |
| `app.push_vapid_keys` | 1 | 1 | 1 |
| `app.saved_views` | 0 | 0 | 0 |
| `app.seed_runs` | 1 | 1 | 1 |
| `app.sentinel_keys` | 1 | 1 | 1 |
| `app.sessions` | 343 | 343 | 352 |
| `app.setup_tokens` | 1 | 1 | 1 |
| `app.shared_canvases` | 0 | 0 | 0 |
| `app.telegram_group_connect_codes` | 1 | 1 | 1 |
| `app.telegram_groups` | 0 | 0 | 0 |
| `app.telegram_link_codes` | 0 | 0 | 0 |
| `app.telegram_links` | 1 | 1 | 1 |
| `app.unit_roles` | 6 | 6 | 6 |
| `app.units` | 5 | 5 | 5 |
| `app.uploads` | 2 | 2 | 2 |
| `app.user_security` | 6 | 6 | 6 |
| `app.users` | 67 | 67 | 67 |
| `app.wipe_requests` | 1 | 1 | 1 |
| `app.work_capacity` | 6 | 6 | 6 |
| `app.work_templates` | 2 | 2 | 2 |
| `audit.anchors` | 0 | 0 | 0 |
| `audit.events` | 12298 | 12298 | 12313 |
| `audit.private_reads` | 105 | 105 | 120 |

_4 table(s) have grown since the dump was taken (expected on a live system)._

## MinIO mirror

Endpoint: `http://minio:9000`

| Bucket | Role | Objects | Bytes | Restored into | Byte-for-byte identical |
|---|---|---:|---:|---|---|
| `devon-backups` | backup mirror | 2 | 2.3 MiB | `devon-drill-20260913t070421z-devon-backups` (removed) | yes |
| `devon` | application object store | 3 | 2.5 KiB | `devon-drill-20260913t070421z-devon` (removed) | yes |

## What a failure means

| Failing check | First action |
|---|---|
| `pg_restore ... exits cleanly` | The newest backup is unusable. Drill the previous one (`--file`) and treat the gap as a live incident: `docs/ops/RUNBOOK.md` → "Backup or drill failed". |
| `restored database lists every migration` | The dump was taken while migrations were mid-flight, or `pg_restore` dropped objects. Re-take a backup and re-drill before trusting it. |
| `row-level-security policies survive the restore` | A restore from this backup would serve cross-department rows (I-1). Do not cut over to it. |
| `every table restores with the row count recorded at dump time` | Data loss between dump and restore. Compare the named tables against the live database before using this backup for anything. |
| `MinIO ... restores into a scratch bucket` | The off-host copy is missing or incomplete: a host loss or a wipe would take the backups with it. Check `BACKUP_MIRROR_TO_MINIO` and the backup job log. |

---

Generated by `tools/backup/restore-drill.mjs` (HARDENING H19.1). Weekly schedule: `infra/backup/systemd/devon-restore-drill.timer` or `infra/backup/crontab.example`. Quarterly checklist: `docs/ops/CHECKLIST-QUARTERLY-DRILL.md`.
