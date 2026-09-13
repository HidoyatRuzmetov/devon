# Go-live checklist — the first ministry deployment

**Qisqacha (uz-Latn).** Bu ro'yxat — haqiqiy foydalanuvchilar tizimga kirishidan oldingi yakuniy
imzo. Har bir band tekshiriladigan dalilni talab qiladi: «bajarildi» emas, balki buyruq natijasi yoki
ekran ko'rinishi. **To'siq (blocker)** deb belgilangan bandlarning birortasi bajarilmasa, ishga
tushirish qoldiriladi. Ro'yxat uchta qismdan iborat: platforma, xavfsizlik va odamlar. Oxirida
kim nimaga javob berishi va qaysi hollarda orqaga qaytish kerakligi yozilgan.

---

Sign-off before real people depend on this. Every line asks for **evidence** — a command's output or
a screen you actually looked at — not a tick. A line marked **BLOCKER** stops the launch: postpone
rather than launch past it.

| | |
|---|---|
| Instance | `https://______________________` |
| Host | `______________________` |
| Release tag | `v____________` |
| Date | `____________` |
| Signed off by | `______________________` (operator) / `______________________` (department head) |

---

## A. The platform answers

| # | Check | Evidence | ✔ |
|---|---|---|---|
| A1 | **BLOCKER** `curl -sk .../readyz` returns `200` | paste the output | ☐ |
| A2 | `curl -sI http://<host>` returns `308` to HTTPS | status line | ☐ |
| A3 | Every container is healthy, none restarting: `dc ps` | paste | ☐ |
| A4 | The SPA loads in a real browser on a real department machine, not just on the server | screenshot | ☐ |
| A5 | The app is in **uz-Latn** by default, and all four locales switch cleanly | screenshot of the switcher | ☐ |
| A6 | `curl -sk .../robots.txt` disallows the app; an app route serves `noindex` | paste | ☐ |
| A7 | Source maps are **not** served: `.../assets/*.js.map` → `404` | status code | ☐ |
| A8 | Security headers present on the SPA document: HSTS, CSP, `frame-ancestors 'none'`, `X-Content-Type-Options` | paste the header block | ☐ |
| A9 | `NODE_ENV=production`, `DEVON_DEMO=0`, `DEVON_E2E=0`, `DEVON_SETUP_REMOTE=0` in `.env` | paste (values redacted) | ☐ |
| A10 | No demo data: the header shows **no** "Namoyish / Demo" chip, and no demo account can sign in | screenshot | ☐ |

## B. The data path works

| # | Check | Evidence | ✔ |
|---|---|---|---|
| B1 | **BLOCKER** Migrations all applied: `/readyz` is `200` **and** `select count(*) from app._migrations` matches the file count in `packages/db/migrations/` | both numbers | ☐ |
| B2 | **BLOCKER** A real member can move a card and it persists across a reload | screenshot / short recording | ☐ |
| B3 | Realtime works: two browsers, one card move, the other updates without a refresh | note which two accounts | ☐ |
| B4 | An avatar upload succeeds, and ClamAV actually scanned it (`dc exec clamav clamdcheck.sh`) | paste | ☐ |
| B5 | Uploading the EICAR test string is **rejected** | screenshot of the refusal | ☐ |
| B6 | An event with an RSVP, a carpool and a poll round-trips | note the event id | ☐ |
| B7 | The inbox receives a notification for an action someone else took | screenshot | ☐ |
| B8 | Telegram: the bot answers `/start` and links an account — or the three `TELEGRAM_*` variables are deliberately unset and the feature is hidden | whichever applies | ☐ |
| B9 | AI: a helper returns a real answer — or `AI_API_KEY` is deliberately unset and every AI affordance is hidden, not broken | screenshot | ☐ |

## C. Backups — the part that is never ready by accident

| # | Check | Evidence | ✔ |
|---|---|---|---|
| C1 | **BLOCKER** A backup exists and was taken **today**: `ls -la $BACKUP_DIR` + the last `manifest.log` line | paste | ☐ |
| C2 | **BLOCKER** `BACKUP_ENCRYPTION_PASSPHRASE` is set and the newest backup is a `.dump.gpg` | filename | ☐ |
| C3 | **BLOCKER** A **person other than the installer** holds a copy of that passphrase, off this host | who, and where | ☐ |
| C4 | **BLOCKER** `node tools/backup/restore-drill.mjs` passes with **0 failed and 0 skipped** checks | the report path + its verdict line | ☐ |
| C5 | `BACKUP_DIR` is **outside** `/opt/devon` — a wipe must not delete the backups | the path | ☐ |
| C6 | The off-host mirror is on a **different machine** (`BACKUP_MIRROR_TO_MINIO=1`) and the drill's MinIO check PASSED, not SKIPPED | the drill report's MinIO section | ☐ |
| C7 | All three timers are active: `systemctl list-timers 'devon-*'` | paste | ☐ |
| C8 | **A human is alerted when a backup or drill job fails** — name the mechanism. A failing job nobody sees is the same as no backup | the mechanism | ☐ |
| C9 | The quarterly drill is in someone's calendar, with `docs/ops/CHECKLIST-QUARTERLY-DRILL.md` linked | whose calendar | ☐ |
| C10 | A restore has been performed at least once by the person who would have to do it under pressure | who, when | ☐ |

## D. Security

| # | Check | Evidence | ✔ |
|---|---|---|---|
| D1 | **BLOCKER** The super admin account has a real password **and 2FA enabled** | screenshot of the 2FA state | ☐ |
| D2 | **BLOCKER** No secret is in the repository: `node agentic/scripts/check-secrets.mjs` → `hits=0`; `.env` is `0600` and not tracked | paste both | ☐ |
| D3 | **BLOCKER** Cross-department isolation: sign in as a member of department A and confirm nothing from department B is reachable, including by guessing an id in a URL (I-1, I-8a) | the two ids tried | ☐ |
| D4 | A member cannot reach `/admin/*` — it renders the no-permission state, and the API refuses it too | screenshot + status code | ☐ |
| D5 | `CLAMAV_MODE=clamd` and `clamdcheck.sh` passes | paste | ☐ |
| D6 | Only 22, 80 and 443 are open inbound: `ss -ltnp` and the firewall rules | paste | ☐ |
| D7 | Postgres, Valkey, MinIO and Centrifugo publish **no** host ports in the production compose file | `dc ps` port column | ☐ |
| D8 | The sentinel runs, listens on `127.0.0.1` only, and `node infra/sentinel/scripts/prove.mjs` refuses all four break attempts | paste the prove output | ☐ |
| D9 | The sentinel **private key is not on this host**, and someone specific holds it | who | ☐ |
| D10 | TLS: a publicly trusted certificate, or the internal CA distributed to department machines. Note the expiry date and who is reminded | expiry date + owner | ☐ |
| D11 | Audit chain verifies: `audit.verify_chain()` reports `ok` | paste | ☐ |
| D12 | The audit anchor path (`AUDIT_ANCHOR_PATH`) is on a path the backup job also copies | the path | ☐ |

## E. Operations

| # | Check | Evidence | ✔ |
|---|---|---|---|
| E1 | Someone other than the installer has performed a restart from `RUNBOOK.md` and it worked | who | ☐ |
| E2 | Pause and resume have been exercised end to end, and the paused page reads correctly in all four locales | screenshots | ☐ |
| E3 | The maintenance page is reachable with `api`/`web` stopped (`dc stop api web`, load the site, `dc up -d api web`) | screenshot | ☐ |
| E4 | `scripts/update.sh --to <tag> --dry-run` runs clean on this host | paste | ☐ |
| E5 | The rollback procedure has been read by the person who would run it: `scripts/update.sh --rollback` | who | ☐ |
| E6 | Logs are being retained and are readable: `dc logs --tail=50 api` | paste | ☐ |
| E7 | Disk has ≥ 20 GB free and someone is alerted below a threshold | `df -h /` + the mechanism | ☐ |
| E8 | The health page in the super admin console has been opened and understood | screenshot | ☐ |
| E9 | An incident note template is where the on-call person can find it (`RUNBOOK.md` → Incident template) | where | ☐ |
| E10 | The release tag is a tag, not a branch: `git describe --tags` on the host | paste | ☐ |

## F. People — the part checklists usually omit

| # | Check | Evidence | ✔ |
|---|---|---|---|
| F1 | **BLOCKER** A named person is responsible for this instance, and a named backup for when they are away | both names | ☐ |
| F2 | The department head has signed in, created the real structure, and approved it as correct | their confirmation | ☐ |
| F3 | At least three real members have signed in and completed one real task each | who | ☐ |
| F4 | The join key and join password have been delivered to the department through a channel that is not this system | how | ☐ |
| F5 | People know the address, and know who to contact when something breaks | how they were told | ☐ |
| F6 | Someone has read `docs/ops/RUNBOOK.md` end to end, before needing it | who | ☐ |
| F7 | Nobody's personal contact details beyond work fields were imported (I-2) | confirm | ☐ |
| F8 | The launch is not on a Friday, and not the day before a holiday | the date | ☐ |

---

## Sign-off

Launch only with every **BLOCKER** line evidenced. Everything else may be carried as a dated
follow-up with an owner — write those here rather than leaving them implicit:

| Carried follow-up | Owner | By when |
|---|---|---|
|  |  |  |
|  |  |  |

**Abort criteria — stop the launch and roll back if any of these is true on the day:**

- `/readyz` is not consistently `200`;
- the newest backup does not restore (`tools/backup/restore-drill.mjs` fails);
- a member can see another department's data;
- the super admin account has no 2FA, or its credentials were shared over a channel you would not
  put a password on;
- nobody available today knows how to restore this instance.

| Role | Name | Date | Signature |
|---|---|---|---|
| Operator |  |  |  |
| Department head |  |  |  |
| Security reviewer |  |  |  |

---

Afterwards: file the completed checklist with the department's records, and diarise the first
quarterly drill (`docs/ops/CHECKLIST-QUARTERLY-DRILL.md`) for three months from today.
