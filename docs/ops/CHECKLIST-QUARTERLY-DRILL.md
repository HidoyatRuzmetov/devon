# Quarterly restore drill — checklist

**Qisqacha (uz-Latn).** Har chorakda bir marta, jonli xizmatga tegmagan holda, zaxira nusxadan
to'liq tiklash mashqi o'tkaziladi. Haftalik avtomatik mashqdan farqi: buni **odam** bajaradi, vaqtni
o'lchaydi, hisobotni o'qiydi va «agar bugun serverni yo'qotsak, nima bo'ladi?» degan savolga aniq
javob yozadi. Har bir chorakda bu ishni haftalik jadval bajarayotgan odam emas, boshqa kishi
bajarsa yaxshi — shunda bilim bir kishida qolib ketmaydi. Mashq oxirida hisobot
`agentic/ledger/backups/` ichiga saqlanadi.

---

**Cadence:** once a quarter, on a calendar invite with a named owner. **Duration:** about an hour.
**Whose turn:** rotate it — ideally the person who would *not* normally do the restore, so the
knowledge does not live in one head.

| | |
|---|---|
| Quarter | `____ Q__` |
| Date | `____________` |
| Run by | `______________________` |
| Release tag on the host | `v____________` |
| Report | `agentic/ledger/backups/restore-drill-____________.md` |

## What this adds to the weekly job

The weekly timer (`devon-restore-drill.timer`) runs the same script unattended and alerts on failure.
The quarterly drill exists for the things automation cannot do:

- it runs **with `migrate:verify`** (the weekly run skips it to stay off Testcontainers);
- a **human reads the report**, including the numbers that are not failures — restore time, row-count
  drift, how many objects the mirror actually holds;
- it answers the question the weekly job never asks: *if we lost this host right now, what exactly
  would we do, with what, and how long would it take?*
- it proves the answer is not stored only in one person's memory.

---

## 1. Before you start

| # | Step | ✔ |
|---|---|---|
| 1.1 | Announce it. This touches nothing live, but a drill nobody knows about looks like an incident | ☐ |
| 1.2 | Read the last quarter's report — you are looking for changes since then, not absolutes | ☐ |
| 1.3 | Confirm free disk for a second copy of the database: `df -h /` | ☐ |
| 1.4 | Note the current release tag: `git -C /opt/devon describe --tags` | ☐ |

## 2. Prove the backup chain is intact

```bash
cd /opt/devon
ls -la "${BACKUP_DIR:-/var/backups/devon}"/devon-*.dump*
tail -20 "${BACKUP_DIR:-/var/backups/devon}/manifest.log"
```

| # | Check | Record | ✔ |
|---|---|---|---|
| 2.1 | A backup exists for **every day** of the retention window — no silent gap | oldest / newest date | ☐ |
| 2.2 | The monthly archive points are present, one per month, for up to a year | how many | ☐ |
| 2.3 | Every recent file is `.dump.gpg` (encrypted) | yes / no | ☐ |
| 2.4 | `manifest.log`'s recorded sha256 matches the file on disk for the newest backup (`sha256sum`) | matched? | ☐ |
| 2.5 | The backup size trend is sane — a sudden drop is a truncated dump, a sudden jump is worth explaining | this vs last quarter | ☐ |

## 3. Run the full drill

```bash
node tools/backup/restore-drill.mjs \
  --report "agentic/ledger/backups/restore-drill-$(date -u +%Y%m%dT%H%M%SZ).md"
```

Note: **no `--skip-migrate-verify`** — that is the whole point of the quarterly run.

| # | Check | Record | ✔ |
|---|---|---|---|
| 3.1 | Verdict is **PASS** with `0 failed, 0 skipped` | paste the verdict line | ☐ |
| 3.2 | Restore duration | ____ s (last quarter: ____ s) | ☐ |
| 3.3 | Row counts match the manifest for every table | tables compared: ____ | ☐ |
| 3.4 | Migration ledger complete in the restored database | ____ / ____ | ☐ |
| 3.5 | RLS policy count identical to live | ____ vs ____ | ☐ |
| 3.6 | `migrate:verify` passes | checks: ____ | ☐ |
| 3.7 | The MinIO mirror restored byte-for-byte, and the backup being drilled is in it | objects / bytes | ☐ |

> A **skipped** MinIO check is a failed drill in disguise: it means there is no off-host copy to
> restore, so a host loss or a wipe takes the backups with it. Fix it before closing the drill.

## 4. Drill the encrypted path with the passphrase you actually stored

The point is not that `gpg` works. It is that **the passphrase written down three months ago is the
one that decrypts today's backups.** Fetch it from wherever it is kept — not from
`/etc/devon/backup.env` on the host, which is the copy you would have lost.

```bash
BACKUP_ENCRYPTION_PASSPHRASE='<from the off-host store>' \
  node tools/backup/restore-drill.mjs --skip-minio --skip-migrate-verify \
  --report "agentic/ledger/backups/restore-drill-passphrase-$(date -u +%Y%m%dT%H%M%SZ).md"
```

| # | Check | Record | ✔ |
|---|---|---|---|
| 4.1 | The stored passphrase decrypts the newest backup | yes / no | ☐ |
| 4.2 | The people who hold it are still here and still the right people | names | ☐ |
| 4.3 | It is stored somewhere that survives losing this host **and** losing one person | where | ☐ |

## 5. The question automation cannot ask

Write real answers, not reassuring ones.

| # | Question | Answer |
|---|---|---|
| 5.1 | If this host died an hour ago, how much work would the department have lost? | ____ (the gap between the last backup and now) |
| 5.2 | How long would a full rebuild take — new host, install, restore, verify? | ____ (estimate, and say what it is based on) |
| 5.3 | Who would do it, and are they reachable this week? | ____ |
| 5.4 | Where would the backup come from if this machine and its disks were gone? | ____ |
| 5.5 | What changed since last quarter that affects any of the above? | ____ |
| 5.6 | Has the restore procedure in `RUNBOOK.md` drifted from what you actually did today? | ____ |

If 5.1's answer is longer than the department can tolerate, the fix is a shorter backup interval or
WAL-level PITR (pgBackRest — declared but inert in `infra/docker-compose.yml`), and it is a decision
to raise now, not after an incident.

## 6. Close the drill

| # | Step | ✔ |
|---|---|---|
| 6.1 | Commit the report(s) under `agentic/ledger/backups/` | ☐ |
| 6.2 | Confirm the scratch database and scratch buckets are gone (the script drops them; verify) | ☐ |
| 6.3 | File any follow-up with an owner and a date — a drill that produces no action and found no problem should say so explicitly | ☐ |
| 6.4 | Update `RUNBOOK.md` if anything you did today was not written down | ☐ |
| 6.5 | Book next quarter's drill, with a different person | ☐ |

**Follow-ups**

| Finding | Owner | By when |
|---|---|---|
|  |  |  |

**Verify the cleanup:**

```bash
docker run --rm --network devon -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" \
  "$(awk '/^  postgres:/{f=1} f && /image:/{print $2; exit}' infra/docker-compose.yml)" \
  psql -h postgres -U postgres -tAc \
  "select datname from pg_database where datname like 'devon_drill%' or datname like 'devon_verify%';"
# must print nothing
```

---

Signed: `______________________`  Date: `____________`
