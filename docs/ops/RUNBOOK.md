# Devon (WorkPortal) operations runbook

**Qisqacha (uz-Latn).** Bu — kunlik va favqulodda amallar ro'yxati, har biri aniq buyruqlar bilan:
qayta ishga tushirish, sirlarni almashtirish, zaxiradan tiklash, pauza va uni bekor qilish, butunlay
o'chirish (wipe), Telegram webhook'ini sozlash, AI xizmati ishlamay qolganda, disk to'lganda,
sertifikatni yangilash va hodisa (incident) shabloni. Har bir bo'limda «nima buzilgan bo'lishi
mumkin» va «qanday tekshiriladi» ko'rsatilgan. Buyruqlarni ko'r-ko'rona bajarmang: ogohlantirish
qutilari bor joyda avval o'sha matnni o'qing.

---

Pairs with `docs/ops/INSTALL.md` (first install), `docs/ops/UPDATE.md` (releases), `infra/README.md`
(environment reference) and `infra/k3s/README.md` (the Kubernetes alternative).

All commands assume the repository at `/opt/devon` and `infra/docker-compose.prod.yml`. Substitute
your own path. Prefix with `sudo -u devon` on a host installed by `scripts/install.sh`.

```bash
cd /opt/devon
alias dc='docker compose -f infra/docker-compose.prod.yml'
```

**The three things to check first, in any incident:**

```bash
curl -sk -o /dev/null -w 'readyz %{http_code}\n' https://work.ministry.uz/readyz
dc ps                    # anything unhealthy or restarting?
df -h /                  # disk full is the most common single cause
```

---

## Restart

**One service** (its data/volumes are untouched):

```bash
dc restart api
```

**The application tier only** — Postgres, Valkey and Caddy keep running, so the maintenance page
stays reachable and the database is never restarted for a code problem:

```bash
dc up -d --no-deps api worker web
```

**The whole stack.** Data survives: Postgres and MinIO live in named volumes, not container
filesystems.

```bash
dc down
dc up -d
```

**After a host reboot**: every service has `restart: unless-stopped`, so Docker brings the stack back
by itself. The exception is a service someone `stop`ped by hand before the reboot — Docker remembers
that. `dc ps` shows it.

---

## Rotate secrets

There is no live rotation endpoint: rotating means editing `.env` and restarting what reads it. Each
row below has a different blast radius — read the row before you act on it.

| Secret | Rotate by | Blast radius |
|---|---|---|
| `CSRF_SECRET` | New random value in `.env`, then `dc up -d --no-deps api worker` | Every open session's CSRF token becomes invalid: users see one failure on their next write and must reload. Do it in a low-traffic window, or pause first |
| `POSTGRES_APP_PASSWORD` | `ALTER ROLE devon_app WITH PASSWORD '<new>'` as superuser, update `.env`'s `DATABASE_URL`, restart `api`/`worker` **immediately** | Between the `ALTER` and the restart, `api`/`worker` cannot connect at all. Never do these two on a delay |
| `POSTGRES_SUPERUSER_PASSWORD` | `ALTER ROLE postgres ...`, update `.env` and `/etc/devon/backup.env` if it is duplicated there | Migrations and **every backup/restore script** use it. A stale value makes tonight's backup fail silently at 02:15 — re-run `backup.sh` by hand afterwards to prove it |
| `MINIO_ROOT_USER` / `_PASSWORD` | Prefer a scoped user (`mc admin user add`) over rotating root. If rotating root: update `STORAGE_S3_ACCESS_KEY`/`_SECRET_KEY`, restart `api`/`worker`/`minio` | Presigned URLs already issued keep working until they expire (they carry their own signature); new presigns need the new key live in `api` first |
| `CENTRIFUGO_API_KEY` / `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` | Update `.env`, restart `centrifugo` and `api` | Every connected client is disconnected and reconnects with a fresh token. No data loss — Centrifugo holds nothing durable |
| `TELEGRAM_WEBHOOK_SECRET` | New value (`openssl rand -base64 32 \| tr '+/' '-_'`), restart `api` — it re-registers the webhook itself at boot | Updates sent between the restart and Telegram accepting the new webhook are retried by Telegram. Verify with `getWebhookInfo` (below) |
| `TELEGRAM_BOT_TOKEN` | Revoke and reissue at `@BotFather`, update `.env`, restart `api` | The bot is silent until the restart. Anyone holding the old token *was* the bot — revoke it at BotFather, do not merely stop using it |
| `AI_API_KEY` | Update `.env`, restart `api`/`worker` | AI features hide themselves while the key is invalid; nothing else is affected |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` | Update `.env`, restart `api` | **Silently unsubscribes every browser.** Every user must re-enable push by hand. Rotate only if the private key leaked |
| Sentinel keypair | `node infra/sentinel/scripts/keygen.mjs`, new public key into `/etc/devon/sentinel.conf`, new private key to whoever holds it, `systemctl restart devon-sentinel` | The pause/wipe channel is unusable between rotating one end and the other. Rotate both in the same window |
| TLS certificate (ministry-issued) | Replace the PEM files, `dc restart caddy` | Browsers see the new certificate on the next handshake. Expect a brief connection blip |
| `BACKUP_ENCRYPTION_PASSPHRASE` | **See the warning below** | Every backup still encrypted under the old passphrase becomes unrestorable the moment the old value is gone |
| `RENOVATE_TOKEN` | New fine-grained PAT with the same repo-scoped permissions, update the repo secret, revoke the old token | The next Renovate run fails closed. No runtime impact — Renovate only opens PRs |

> **`BACKUP_ENCRYPTION_PASSPHRASE` is not a drop-in rotation.** Decrypt every existing `.dump.gpg`
> under `BACKUP_DIR` with the OLD passphrase and re-encrypt with the NEW one *first*; only then
> update `/etc/devon/backup.env`. Keep the old passphrase until every backup has been migrated or has
> aged out under retention. Skipping this turns your entire backup history into noise, and you will
> find out on the day you need it.

After any rotation: `curl -sk .../readyz` must be `200`, and `dc logs --tail=50 api worker` must show
no authentication errors.

---

## Restore from backup

```bash
# 1. What is available, and is it intact?
ls -la "${BACKUP_DIR:-/var/backups/devon}"/devon-*.dump*
tail -5 "${BACKUP_DIR:-/var/backups/devon}/manifest.log"     # timestamp, filename, bytes, sha256

# 2. ALWAYS restore into a throwaway database first and look at it.
infra/backup/restore.sh "${BACKUP_DIR}/devon-devon-<timestamp>.dump"
#    -> creates devon_restore_<utc timestamp>; inspect it, count rows, check the newest data is there
```

Only then, over the live database. This is destructive to whatever the target already holds, so the
script requires `--force-production` **and** that you re-type the database name at a prompt:

```bash
# 3a. Stop writes first, or the restore races the application.
#     Pause from the admin console (below), then:
dc stop api worker

# 3b. Restore.
infra/backup/restore.sh "${BACKUP_DIR}/devon-devon-<timestamp>.dump" devon --force-production

# 3c. Back up.
dc up -d api worker
curl -sk -o /dev/null -w '%{http_code}\n' https://work.ministry.uz/readyz   # 200 before lifting the pause
```

Encrypted backups (`.dump.gpg`) need `BACKUP_ENCRYPTION_PASSPHRASE` in the environment; the scripts
decrypt to a temporary file and shred it afterwards.

**What a restore costs you.** Everything written between the dump and now. Check the dump's timestamp
against the incident's start before deciding a restore is the right answer — sometimes a forward fix
on live data loses less.

**What a restore does not roll back.** `audit.events` is append-only and hash-chained (I-5a); a
restore moves its head backwards in time, which `audit.verify_chain()` will report. That is expected
after a restore, and it is worth recording in the incident note so the next person does not read it
as tampering.

---

## Backup or drill failed

The weekly units are `devon-backup.timer` (daily 02:15), `devon-backup-verify.timer` (Sunday 03:30)
and `devon-restore-drill.timer` (Sunday 04:30).

```bash
systemctl list-timers 'devon-*'
systemctl status devon-backup.service devon-backup-verify.service devon-restore-drill.service
journalctl -u devon-restore-drill.service -n 200 --no-pager
ls -la agentic/ledger/backups/            # the drill's own dated reports
```

Treat a failed **verify** or **drill** as an active incident, not a chore: it means the most recent
backup is not trustworthy, which you would otherwise discover only when restoring it.

```bash
# 1. Is it the backup, or the job? Take a fresh one and drill that.
infra/backup/backup.sh
node tools/backup/restore-drill.mjs

# 2. Still failing? Drill the previous backup to find out how far back the good ones go.
node tools/backup/restore-drill.mjs --file "${BACKUP_DIR}/devon-devon-<older timestamp>.dump"
```

The drill report's "What a failure means" table names the first action for each failing check.

---

## Pause (maintenance mode) and resume

**The normal path — no host access needed.** A super admin toggles it in the console: Admin → System
→ Maintenance mode → write the four-locale message → confirm (`PUT /api/v1/admin/maintenance`).

What it does: every page renders the branded message (super admin login and console stay reachable),
every API call returns `503` with the message body, the Telegram bot answers with the same message,
and Caddy's `handle_errors` block serves the same static page if `api`/`web` are unreachable at the
network level rather than merely paused. So a maintenance message is visible even in a total outage.

**Resume**: the same toggle, off. Confirm with `curl -sk .../api/v1/instance` — `maintenance.enabled`
must be `false` — and then load a real page.

**Pausing one department** rather than the whole instance:
`POST /api/v1/admin/departments/:id/pause` from the console. That department sees its own paused
state; every other department is unaffected.

**Host-level equivalent**, when the API or the console is unreachable, or the super admin account is
locked out:

```bash
dc stop api web worker      # Caddy, Postgres and Valkey stay up and serve the maintenance page
dc up -d api web worker     # resume
```

---

## Wipe (destructive, no undo)

> Read TECH-SPEC §11 and `infra/README.md`'s sentinel section in full before running this on a real
> host. It deletes the containers, images, volumes, the project directory, the logs — and
> `/opt/devon/backups` if your backups are still there. **There is no recovery** unless a backup was
> independently copied off this host.

The sentinel is a host-level service on `127.0.0.1` only, unreachable from any container or from the
network, and it executes only signed, fresh, non-replayed commands (ADR-011).

**Via the console** (the normal path): super admin console → System → Wipe → type the
department-count phrase shown → re-enter password → 2FA if enabled → 60-second cancellable countdown.

**Via the host CLI** (for the CTO, no console needed):

```bash
node infra/sentinel/scripts/devon-wipe.mjs --confirm --key-file /path/to/sentinel-private-key
```

Afterwards, one line is written to `/var/log/devon-wipe.log`. The wipe is audited before it acts
(I-5b).

**Before ever running it**, confirm an off-host copy exists and restores:

```bash
BACKUP_MIRROR_TO_MINIO=1 infra/backup/backup.sh
node tools/backup/restore-drill.mjs           # the MinIO check must PASS, not SKIP
```

---

## Telegram webhook setup

`apps/api` registers the webhook itself, at boot, in production. There is no manual `setWebhook`
step — the URL embeds the secret, and having the process own it is what keeps that secret out of
shell history and proxy access logs.

1. Create the bot with `@BotFather`, note the token and the username.
2. Generate the webhook secret — 32–256 characters of `A-Z a-z 0-9 _ -`, which is Telegram's own
   `secret_token` alphabet:

   ```bash
   openssl rand -base64 32 | tr '+/' '-_'
   ```

3. Put all three in `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`)
   and restart: `dc up -d --no-deps api`. All three or none — the API refuses to boot in production
   with a token and no secret (H1.14).
4. Verify from Telegram's side. `url` must be your public host, `pending_update_count` should settle
   at 0, and `last_error_message` must be empty:

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo" | python3 -m json.tool
   ```

5. Message the bot. `dc logs api | grep telegram` shows the update arriving.

**Common failures**

| Symptom | Cause |
|---|---|
| `getWebhookInfo` shows an SSL error | Caddy is on its internal CA. Telegram requires a publicly trusted certificate — the bot cannot work with `CADDY_TLS_MODE=internal` |
| Webhook set, no updates arrive | Inbound 443 from Telegram's ranges is blocked, or `DEVON_PUBLIC_URL` is not what DNS resolves to |
| Updates rejected, `403` in the logs | `TELEGRAM_WEBHOOK_SECRET` was changed without restarting `api` |
| The log says "falling back to long polling" | `setWebhook` failed at boot. Fix the cause and restart — do not leave polling running as a second, unmonitored ingress |

Never send personal contact details through the bot (I-2).

---

## AI endpoint outage

The GLM endpoint being down is a **degradation, never an outage**. Every AI call is timed out
(`AI_REQUEST_TIMEOUT_MS`, default 60 s) and circuit-broken (H8.1); when it trips, AI features hide
themselves and everything else — boards, events, the inbox, Telegram — keeps working.

```bash
dc logs --tail=200 api worker | grep -i -E 'ai|glm|circuit'
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 10 https://api-llm.gpu.uz/v1/models
```

| Finding | Action |
|---|---|
| The endpoint is unreachable from this host | A network problem, not ours. Confirm outbound access; nothing to change in Devon |
| `401`/`403` | `AI_API_KEY` is wrong or revoked. Rotate it (above) |
| Slow but working, circuit flapping | Raise `AI_REQUEST_TIMEOUT_MS`, restart `api`/`worker`. Raise it deliberately — a long timeout ties up a connection per in-flight request |
| Extended outage | Set `AI_API_KEY` empty and restart: the gateway falls back to its mock provider and the features hide cleanly instead of failing per click |

There is no second provider and there will not be one: the key never leaves this deployment and no
endpoint other than the configured GLM is ever called (decision 15).

---

## Disk full

The first symptom is usually Postgres refusing writes, or a backup that silently produced nothing.

```bash
df -h /
docker system df                                  # images, containers, volumes, build cache
du -sh /var/lib/docker/volumes/* 2>/dev/null | sort -h | tail
du -sh "${BACKUP_DIR:-/var/backups/devon}"
```

Reclaim in this order — safest first:

```bash
# 1. Build cache and dangling images. Never touches a running container or a named volume.
docker builder prune -f
docker image prune -f

# 2. Rotated logs. The compose file already caps each service at 10 × 10 MB.
journalctl --vacuum-time=14d

# 3. Old backups, ONLY through the retention policy -- never with rm.
BACKUP_KEEP_DAYS=14 infra/backup/backup.sh        # takes a fresh one, then prunes under the new window
```

> **Never `docker system prune -a --volumes`.** The `--volumes` flag deletes `postgres_data` and
> `minio_data`. It is the single most destructive command that looks like housekeeping.

If Postgres has already stopped accepting writes, free space first, then restart it and confirm:

```bash
dc restart postgres
dc exec postgres psql -U postgres -d devon -c 'select pg_size_pretty(pg_database_size(current_database()));'
```

Then fix the cause, not the symptom: a backup directory on the same filesystem as the data, a debug
`LOG_LEVEL` left on, or an `audit.events` table that has simply grown (which is correct — it is never
subject to retention, I-3).

---

## Certificate renewal

**Automatic ACME** (no `CADDY_TLS_MODE` in `.env`): Caddy renews about 30 days before expiry, by
itself, with no reload and no cron job. Nothing to do. To confirm:

```bash
echo | openssl s_client -connect work.ministry.uz:443 -servername work.ministry.uz 2>/dev/null \
  | openssl x509 -noout -subject -dates
dc logs caddy | grep -i -E 'certificate|renew'
```

Renewal fails only when :80 stops being reachable from the internet (the HTTP-01 challenge). Check
that before anything else.

**Ministry-issued certificate** (`DEVON_TLS_CERT_FILE`/`DEVON_TLS_KEY_FILE`): renewal is yours.

```bash
# 1. Put the new fullchain and key in place (keep the old ones until step 3 passes).
sudo cp fullchain.pem /etc/devon/tls/fullchain.pem
sudo cp privkey.pem  /etc/devon/tls/privkey.pem
# 2. Reload.
dc restart caddy
# 3. Verify the dates actually moved.
echo | openssl s_client -connect work.ministry.uz:443 -servername work.ministry.uz 2>/dev/null \
  | openssl x509 -noout -dates
```

Put a calendar reminder 30 days before expiry. An expired certificate is a total outage with a
confusing error, and it is the most common self-inflicted one.

**Internal CA** (`CADDY_TLS_MODE=internal`): Caddy renews its own leaf certificates silently. The
root is long-lived; if it is ever rotated, every department machine that trusted it must be updated:

```bash
dc exec caddy cat /data/caddy/pki/authorities/local/root.crt
```

---

## Health checks to know

| Endpoint | Meaning |
|---|---|
| `GET /healthz` | The process is alive. No DB or Valkey check — a `200` here does **not** mean the app can serve real traffic. Use it for liveness only |
| `GET /readyz` | `200` only when the database is reachable **and** every migration is applied. This is what a load balancer, a monitor, or a release health gate must watch |
| `GET /metrics` | Prometheus text exposition, loopback-gated by default (`DEVON_METRICS_REMOTE`) |
| `GET /api/v1/instance` | Public: `maintenance`, `setupRequired`, `isDemo`, locales. Useful for confirming a pause is really on |
| Super admin console → health | Queues, DB, storage, Telegram, AI latency, backups — the human-facing view of the same signals |

---

## Incident template

Copy this into the incident note at the first sign of trouble and fill it in as you go. Write it
while the incident is running, not afterwards — the details you lose are the ones that matter.

```markdown
# Incident YYYY-MM-DD-NN -- <one line, what a user would say>

- Detected:        <UTC time> by <alert / person / how>
- Started:         <UTC time, from logs -- often earlier than detection>
- Mitigated:       <UTC time>
- Resolved:        <UTC time>
- Severity:        SEV1 (nobody can work) | SEV2 (a department or a feature is down) | SEV3 (degraded)
- Commander:       <name>
- User impact:     <which departments, how many people, what they could not do>
- Data loss:       none | <exactly what, and the window>

## Timeline (UTC)
| Time | What happened / what we did | Who |
|---|---|---|
|  |  |  |

## What we checked
- [ ] `curl -sk .../readyz`                    -> 
- [ ] `dc ps`                                  -> 
- [ ] `df -h /`                                -> 
- [ ] `dc logs --tail=200 api worker caddy`    -> 
- [ ] super admin console health page          -> 
- [ ] most recent backup + its drill report    -> 

## Cause
<the mechanism, not the person>

## Fix applied
<the exact commands run, so the next person can repeat or reverse them>

## Follow-ups (each one owned and dated)
- [ ] 
```

Keep incident notes in the department's own records. Do not put user contact details or any `.env`
value in them (I-2, I-17).
