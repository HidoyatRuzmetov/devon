# Installing Devon (WorkPortal) on a ministry server

**Qisqacha (uz-Latn).** Bu hujjat Devonni noldan yangi vazirlik serveriga o'rnatishni bosqichma-bosqich
tushuntiradi: Ubuntu 24.04, Docker Engine va Compose, `infra/docker-compose.prod.yml`, haqiqiy domen
va avtomatik TLS bilan Caddy, har bir muhit o'zgaruvchisi izohlangan `.env`, birinchi ishga tushirish,
migratsiyalar, `/setup` orqali super admin tayinlash marosimi va yakuniy tekshiruvlar. Takrorlanadigan
qismini `sudo bash scripts/install.sh` bajaradi — uni istalgan vaqtda qayta ishga tushirish xavfsiz.
Har bir buyruqni ko'chirib bajaring; hech bir bosqichni o'tkazib yubormang, ayniqsa zaxira nusxa va
migratsiya bosqichlarini.

---

This is the zero-to-running procedure for a **new** ministry server. For upgrading a server that is
already running, read `docs/ops/UPDATE.md`. For day-to-day operations, `docs/ops/RUNBOOK.md`. For the
final sign-off before real people use it, `docs/ops/CHECKLIST-GO-LIVE.md`.

Budget about two hours the first time, most of it waiting for image builds and the ClamAV signature
download.

| | |
|---|---|
| Target host | One Ubuntu 24.04 LTS server, x86_64 or arm64. No orchestrator (TECH-SPEC §19, decision 2) |
| Minimum | 4 vCPU, 8 GB RAM, 50 GB disk. Below 20 GB free, backups fail silently at 02:15 |
| Ingress | TCP 80 and 443 reachable by the department. Nothing else needs to be open |
| Outbound | The GLM endpoint (`api-llm.gpu.uz`) for AI, `api.telegram.org` for the bot, a registry or the internet for images. All three are optional — Devon runs fully without any of them |
| Scripted | Steps 1–3 and 10: `sudo bash scripts/install.sh` |
| Never scripted | The `.env` values only a human knows, the migration step, the super-admin ceremony |

## 1. Prepare the host

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo timedatectl set-timezone Asia/Tashkent     # UTC is stored; this is only for host logs
sudo hostnamectl set-hostname devon
```

Check the two things that most often break an install before it starts:

```bash
df -h /opt                       # >= 20 GB free
sudo ss -ltnp | grep -E ':(80|443)\b'   # must print nothing (nginx/apache2 often hold :80)
```

## 2. Install Docker Engine and the Compose plugin

Use Docker's own repository, not Ubuntu's `docker.io` package: the Compose **plugin**
(`docker compose`, not the retired `docker-compose` script) only ships there, and every compose file
in this repository uses Compose v2 syntax.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$UBUNTU_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker compose version     # must print v2.x
```

Node ≥ 22 on the host as well — the weekly restore drill (`tools/backup/restore-drill.mjs`) runs
outside Docker:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs gnupg git
```

## 3. Get the code and run the installer

```bash
sudo git clone <this repository> /opt/devon
cd /opt/devon
sudo git checkout v1.1.0          # always a tag, never a moving branch, on a real server
sudo bash scripts/install.sh --domain work.ministry.uz --backup-dir /var/backups/devon --firewall
```

`scripts/install.sh` is idempotent — run it again any time. It creates the `devon` service account,
the directories, a complete `.env` with freshly generated secrets, `/etc/devon/backup.env` with a
generated backup-encryption passphrase, and the three backup/verify/restore-drill systemd timers. It
deliberately does **not** start the stack, run migrations, or overwrite an existing `.env`. Use
`--dry-run` first if you want to see every step without changing anything.

> **Copy `/etc/devon/backup.env`'s `BACKUP_ENCRYPTION_PASSPHRASE` somewhere off this host today.**
> Without it every encrypted backup on this machine is unrecoverable — including the backups you
> would reach for after losing this machine.

## 4. Finish `.env`

`scripts/install.sh` generated `/opt/devon/.env` (0600, owned by `devon`). Everything below is what
each variable means, why it exists, and what happens if it is wrong. `.env` is never committed
(I-17); `infra/docker-compose.prod.yml` loads it into `api` and `worker` through `env_file`.

Three values are refused outright at boot if they still hold their `.env.example` local-dev value
(`apps/api/src/config.ts`'s production guard, H17.1): `CSRF_SECRET`, `DATABASE_URL`,
`STORAGE_S3_SECRET_KEY`. Generate real ones with `openssl rand -hex 32`.

### Runtime

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | `development` | Must be `production`. It is what turns on the config guard, the secure-cookie flags, the generic error bodies and the refusal to run the demo seed |
| `DEVON_PUBLIC_URL` | `http://localhost:5173` | The real hostname with scheme, **no trailing slash**. It is simultaneously the CORS origin, the cookie domain, the base of every link in a notification/Telegram message, and the site address Caddy answers on. Get it wrong and logins fail with an opaque CSRF error |
| `DEVON_ALLOWED_ORIGINS` | empty | Extra CORS origins, comma-separated. There is deliberately no wildcard form. Leave empty unless a separate admin host exists |
| `API_PORT` | `3000` | Inside the container only; nothing publishes it |
| `LOG_LEVEL` | `info` | `debug` is for an incident, not for steady state — it logs a line per query |
| `SLOW_REQUEST_MS` | `1000` | A handler slower than this gets its own `warn` line on top of the normal completion line |
| `DEVON_METRICS_REMOTE` | `0` | `/metrics` (Prometheus) is loopback-gated. `1` only when the scraper genuinely cannot reach the host's own loopback |
| `DEVON_CSP_CONNECT_EXTRA` | empty | Added to the SPA's `connect-src`. Set it to `STORAGE_S3_PUBLIC_ENDPOINT`'s origin when `STORAGE_DRIVER=s3`, or avatar uploads are blocked by CSP with no server-side error to find |

### Postgres

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_DB` | `devon` | Database name. Also what `infra/backup/*.sh` name their dump files after |
| `POSTGRES_SUPERUSER_PASSWORD` | — | The `postgres` role. Used by migrations and by every backup/restore script. Required |
| `POSTGRES_APP_USER` / `POSTGRES_APP_PASSWORD` | `devon_app` / — | The least-privilege role the application runs as: it can `INSERT`/`SELECT` on `audit`, and nothing more (I-5a) |
| `POSTGRES_MIGRATOR_USER` / `POSTGRES_MIGRATOR_PASSWORD` | `devon_migrator` / — | Used only by the migration step |
| `DATABASE_URL` | — | The app's connection string. In Compose the hostname is the **service name** `postgres`, not `127.0.0.1`: `infra/docker-compose.prod.yml` overrides this for the `api`/`worker` containers precisely so a host-perspective value in `.env` cannot break them |
| `MIGRATION_DATABASE_URL` | — | Connects as the **superuser**, deliberately: migration `0001_roles.sql` CREATEs `devon_migrator` and `devon_app`, so the connection that applies it cannot authenticate as a role that does not exist yet on a fresh database |

Production publishes no host port for Postgres — it is reachable only on the `devon` Docker network.
Every backup script already runs `pg_dump`/`pg_restore` from a throwaway container on that network,
so nothing needs the port.

### Valkey, sessions, CSRF

| Variable | Default | What it does |
|---|---|---|
| `VALKEY_URL` | `redis://valkey:6379` | Session cache, rate limits, Centrifugo's broker. Holds nothing durable — Postgres is the sole session-revocation record (ADR-003), so losing Valkey costs a cache warm-up, never a logout storm |
| `SESSION_COOKIE_NAME` | `devon_sid` | Change only if something else on the domain collides |
| `SESSION_IDLE_MINUTES` | `720` | Idle timeout. 12 h is a working day plus lunch |
| `SESSION_ABSOLUTE_DAYS` | `30` | Hard ceiling regardless of activity |
| `CSRF_SECRET` | — | Double-submit CSRF token key. **Must be random.** Rotating it invalidates every open session's token: users see one CSRF failure and must reload (`RUNBOOK.md` → Rotate secrets) |
| `AUDIT_ANCHOR_PATH` | `./.data/audit-anchor.log` | Where the nightly audit-chain head is anchored **outside** the database (I-5a). On a real host, put it on a path the backup job also copies |

### Request limits

| Variable | Default | What it does |
|---|---|---|
| `HTTP_BODY_LIMIT_BYTES` | `1048576` | 1 MiB. Uploads do not go through this path — they are presigned |
| `JSON_MAX_DEPTH` | `16` | Bounds a deeply-nested JSON body, which costs the parser and every recursive validator far more CPU per byte than a flat one |
| `AI_MAX_INPUT_BYTES` | `32768` | Ceiling on an AI request's input, so one request cannot become an unbounded GLM bill |

### Object storage

`STORAGE_DRIVER=local` (files on the API container's disk) is the developer default. **Production
uses `s3`** against the bundled MinIO, so avatars and attachments survive a container being replaced.

| Variable | Default | What it does |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `s3` in production |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | — | MinIO's own admin credentials. Required by the `minio` profile |
| `STORAGE_S3_ENDPOINT` | — | What **the API** reaches: `http://minio:9000` on the Compose network |
| `STORAGE_S3_PUBLIC_ENDPOINT` | = endpoint | What **the browser** reaches. A presigned URL's signature covers its host, so this must be the public name (e.g. `https://work.ministry.uz/objects`), routed to MinIO by Caddy |
| `STORAGE_S3_ACCESS_KEY` / `STORAGE_S3_SECRET_KEY` | — | Prefer a scoped MinIO user over root (`mc admin user add`), so a compromised app credential cannot also delete backups |
| `STORAGE_S3_BUCKET` / `STORAGE_S3_REGION` | `devon` / `us-east-1` | The bucket is created on first use |
| `STORAGE_S3_FORCE_PATH_STYLE` | `true` | MinIO needs path-style addressing |
| `STORAGE_MAX_UPLOAD_BYTES` | `5242880` | 5 MiB, enforced at presign, at PUT and at finalise |
| `STORAGE_TIMEOUT_MS` | `10000` | Every MinIO call carries it (H8.1) |

### Malware scanning

| Variable | Default | What it does |
|---|---|---|
| `CLAMAV_MODE` | `off` | **`clamd` in production.** `apps/api` refuses to start with `NODE_ENV=production` and `CLAMAV_MODE=off` — an unscanned upload path is a developer convenience, never a deployment |
| `CLAMAV_HOST` / `CLAMAV_PORT` | `127.0.0.1` / `3310` | `clamav` / `3310` on the Compose network |
| `CLAMAV_TIMEOUT_MS` | `20000` | Per-scan timeout. clamd unreachable fails the upload closed |

An air-gapped box must mirror the ClamAV signature feed itself: `freshclam` needs internet by
default, and the first start-up downloads the whole database (expect five minutes before the
container is healthy).

### Telegram

All three or none. The API refuses to boot in production with a bot token and no webhook secret
(H1.14) — otherwise the bot would either fall back to long polling (a second, unmonitored ingress) or
register a webhook whose only protection is the token itself.

| Variable | What it does |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From `@BotFather`. Treat it as a password: anyone holding it is the bot |
| `TELEGRAM_BOT_USERNAME` | Without the `@`. Used to build deep links and the Mini App URL |
| `TELEGRAM_WEBHOOK_SECRET` | 32–256 characters of `A-Z a-z 0-9 _ -`, from a CSPRNG: `openssl rand -base64 32 \| tr '+/' '-_'`. Telegram sends it back in a header on every update; a mismatch is rejected |

Registering the webhook is a separate step — `RUNBOOK.md` → "Telegram webhook setup".

### AI

| Variable | Default | What it does |
|---|---|---|
| `AI_BASE_URL` | `https://api-llm.gpu.uz/v1` | The government GPU cluster. Do not point this anywhere else (decision 15) |
| `AI_MODEL` | `glm-5.2` | |
| `AI_API_KEY` | unset | **Never in the repository.** Without it the gateway falls back to a mock provider and every AI feature hides itself — a correct, fully usable deployment, just without the helpers |
| `AI_REQUEST_TIMEOUT_MS` | `60000` | Every call is timed out and circuit-broken (H8.1); an AI outage degrades, never blocks |

### Realtime and web push

| Variable | Default | What it does |
|---|---|---|
| `CENTRIFUGO_WS_URL` | empty | What the browser connects to, e.g. `wss://work.ministry.uz/realtime/connection/websocket`. Empty means realtime is off and the board shows its "Jonli rejim oʻchiq" pill |
| `CENTRIFUGO_API_URL` | empty | `http://centrifugo:8000/api` on the Compose network |
| `CENTRIFUGO_API_KEY` | empty | The API's credential for publishing |
| `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` | empty | Signs the short-lived per-user connection tokens |
| `CENTRIFUGO_TOKEN_TTL_SECONDS` | `600` | Max 3600 |
| `CENTRIFUGO_TIMEOUT_MS` | `3000` | |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | unset | Web push. Generate with `npx web-push generate-vapid-keys`. **Rotating them silently unsubscribes every browser**, so generate once and keep them |

### TLS, images, setup flags, sentinel

| Variable | Default | What it does |
|---|---|---|
| `CADDY_TLS_MODE` | `internal` | Caddy's own CA: works offline, with no public DNS. Every browser warns until that CA is trusted |
| `DEVON_TLS_CERT_FILE` / `DEVON_TLS_KEY_FILE` | unset | A ministry-issued certificate. See §6 |
| `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` | `80` / `443` | Only change behind another proxy |
| `DEVON_API_IMAGE` / `DEVON_WEB_IMAGE` / `DEVON_WORKER_IMAGE` | build locally | Set them once a registry exists, so `up -d` pulls instead of rebuilding on every host |
| `DEVON_SETUP_REMOTE` | `0` | The one-time `/setup` endpoint is loopback-gated. `1` only for the duration of §8, if you genuinely cannot reach the host's own loopback |
| `DEVON_DEMO` | `0` | Must stay `0`. The demo seed refuses to run under `NODE_ENV=production` anyway |
| `DEVON_E2E` | `0` | Must stay `0`. Compiles in the Playwright forcing hooks |
| `SENTINEL_HOST` / `SENTINEL_PORT` | `127.0.0.1` / `8787` | The host-level pause/wipe executor. Loopback only, always |
| `SENTINEL_PUBLIC_KEY` | empty | The ed25519 public key whose private half signs pause/wipe commands. See §10 |

### Backup variables — host environment, not `.env`

These are read by the backup cron/systemd units, never by a compose service.
`scripts/install.sh` writes them to `/etc/devon/backup.env` (0600, root).

| Variable | Default | What it does |
|---|---|---|
| `BACKUP_DIR` | `<repo>/backups` | **Point it outside `/opt/devon`.** The sentinel's wipe deletes the project directory and everything under it — a backup there is deleted by the very event it exists for. `/var/backups/devon` is the installer's default |
| `BACKUP_ENCRYPTION_PASSPHRASE` | unset | Unset means the dump is written **unencrypted** with a loud warning. Never acceptable on a real deployment |
| `BACKUP_KEEP_DAYS` / `BACKUP_KEEP_MONTHS` / `BACKUP_MIN_KEEP` | `30` / `12` / `3` | 30 days of dailies plus one archive point per month for a year, and never fewer than 3 backups whatever their age |
| `BACKUP_MIRROR_TO_MINIO` | `0` | `1` copies each finished backup off-host. Set it, and point `BACKUP_MINIO_ENDPOINT` at storage on a **different machine** |
| `BACKUP_MINIO_ENDPOINT` / `_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET` | fall back to `STORAGE_S3_*` / `devon-backups` | A dedicated backup-only credential is strongly preferred, so a compromised app credential cannot delete the backups too |

## 5. Build the images

From the repository root, so the whole pnpm workspace (lockfile + every manifest) is in the build
context:

```bash
cd /opt/devon
sudo -u devon docker compose -f infra/docker-compose.prod.yml build
```

Every build uses `--frozen-lockfile`: it fails rather than silently resolving a dependency tree
different from the one the release gate tested. Base images are pinned by digest (H18.1) — a tag can
be repointed by the registry, a digest cannot. To move to a newer base deliberately:

```bash
docker buildx imagetools inspect <image>:<new-tag> | grep '^Digest:'
```

## 6. TLS and the domain

Point an A/AAAA record (or the ministry's internal DNS) at this host, matching `DEVON_PUBLIC_URL`.

**Automatic TLS from Let's Encrypt** — the default when the host is genuinely reachable from the
internet on :80 and :443. Remove `CADDY_TLS_MODE` from `.env` entirely; Caddy's site block then uses
its public ACME path, obtains a certificate on first request and renews it by itself, ~30 days
before expiry, with no cron job and no reload.

**A ministry-issued certificate** — replace the `tls {$CADDY_TLS_MODE:internal}` line in
`infra/Caddyfile` with `tls {$DEVON_TLS_CERT_FILE} {$DEVON_TLS_KEY_FILE}`, mount the two PEM files
into the `caddy` container, and set the two variables. Renewal is then yours: `RUNBOOK.md` →
"Certificate renewal".

**Air-gapped** — keep `CADDY_TLS_MODE=internal`. Caddy runs its own CA, no internet and no public DNS
needed. Browsers warn on first visit until that CA is distributed to the department's machines
(`docker compose ... exec caddy cat /data/caddy/pki/authorities/local/root.crt`).

Whatever you choose, HTTPS is forced: Caddy redirects :80 → :443 the moment a `tls` directive is
present, which it always is.

## 7. First boot and migrations

Migrations run **before** the application containers start, never inside them (H18.1). Bring up only
the data tier first:

```bash
cd /opt/devon
sudo -u devon docker compose -f infra/docker-compose.prod.yml up -d --wait postgres valkey
```

Then apply them, as the superuser (see `MIGRATION_DATABASE_URL` above for why):

```bash
sudo -u devon docker compose -f infra/docker-compose.prod.yml run --rm --no-deps \
  -e MIGRATION_DATABASE_URL \
  api pnpm --filter @devon/db migrate:apply
```

Now start everything:

```bash
sudo -u devon docker compose -f infra/docker-compose.prod.yml \
  --profile minio --profile clamav --profile centrifugo up -d
```

`caddy` waits for `api` and `web` to report healthy before it starts routing, so there is no window
where the domain answers with a broken app. ClamAV takes several minutes on its first start while it
downloads signatures; `api` will not accept uploads until it is up.

## 8. The super-admin ceremony

On its very first boot against a database with zero users, the API issues **one single-use setup
link** and prints it to stdout. It is deliberately *not* in the structured log — the URL embeds a
live credential, and a log line would carry it into whatever aggregates and backs those logs up.

```bash
sudo -u devon docker compose -f infra/docker-compose.prod.yml logs api | grep -A2 'First-boot setup link'
```

The endpoint behind it (`POST /api/v1/setup/:token`) is **loopback-gated**, and the gate checks the
real TCP peer address, deliberately never `X-Forwarded-For` — a security gate must not trust a header
an attacker controls (`apps/api/src/lib/net.ts`). That has a consequence worth stating plainly,
because it is the opposite of what most people expect:

> **Behind Caddy, the API's peer is the Caddy container, not you.** Opening the printed URL in a
> browser — from the server, over an SSH tunnel, from anywhere — arrives at the API with a peer
> address on the Docker bridge network and is refused. Publishing the API's port to the host does not
> help either: Docker's NAT rewrites the source to the bridge gateway, which is still not loopback.

So on a containerised deployment there are exactly two honest paths.

**A. Through the browser (recommended).** Open the gate for the length of the ceremony and close it
immediately. The link itself is single-use and exists only in your terminal, so the exposure window
is small — but make it small anyway, before the address has been announced to anyone:

```bash
sudo -u devon sed -i 's/^DEVON_SETUP_REMOTE=0/DEVON_SETUP_REMOTE=1/' /opt/devon/.env
sudo -u devon docker compose -f infra/docker-compose.prod.yml up -d --no-deps api
# ... open the printed link, complete the form ...
sudo -u devon sed -i 's/^DEVON_SETUP_REMOTE=1/DEVON_SETUP_REMOTE=0/' /opt/devon/.env
sudo -u devon docker compose -f infra/docker-compose.prod.yml up -d --no-deps api
curl -sk https://work.ministry.uz/api/v1/instance | grep -o '"setupRequired":[a-z]*'   # false
```

**B. Without opening the gate**, by calling the endpoint from inside the api container, where the
peer genuinely is `127.0.0.1`. Note the shape: the token is a path segment for the API (the `?token=`
form in the printed URL is for the SPA route), and `login` is lowercase `a-z0-9._-`, the password at
least 12 characters:

```bash
sudo -u devon docker compose -f infra/docker-compose.prod.yml exec -T api \
  node -e 'const b={login:process.env.L,password:process.env.P,givenName:process.env.G,familyName:process.env.F,locale:"uz-Latn"};
    fetch("http://127.0.0.1:3000/api/v1/setup/"+process.env.T,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)})
      .then(r=>r.text()).then(t=>console.log(t))'
```

…with `L`, `P`, `G`, `F`, `T` passed as environment variables (`-e L=... -e T=...`) so the password
never appears in the shell history or in `ps`. On k3s, `kubectl -n devon port-forward deploy/devon-api
3000:3000` gives a genuine `127.0.0.1` peer inside the pod, so path A is unnecessary there.

Create the super admin: given name, family name, username, a real password, and — strongly
recommended — 2FA immediately afterwards. This account is the one that approves every department
request and holds the pause and wipe switches. Every one of its actions is audited with the role
recorded (I-5b).

The link is single-use and the server stores only its SHA-256 hash, so it can never be re-printed.
If it is lost before use — and only then, with zero users still in the database — delete the
unconsumed token row and restart the API to have a new one issued:

```bash
sudo -u devon docker compose -f infra/docker-compose.prod.yml exec postgres \
  psql -U postgres -d devon -c "delete from app.setup_tokens where consumed_at is null;"
sudo -u devon docker compose -f infra/docker-compose.prod.yml restart api
```

That deletion is audited. It does nothing once a super admin exists.

## 9. Smoke checks

Run all of these before telling anyone the address. Each one fails differently, which is the point.

```bash
# 1. The process is alive.
curl -sk https://work.ministry.uz/healthz

# 2. The database is reachable AND every migration is applied. This is the one that matters --
#    /healthz is also 200 on a release that cannot serve a single request.
curl -sk -o /dev/null -w '%{http_code}\n' https://work.ministry.uz/readyz     # 200

# 3. HTTP redirects to HTTPS.
curl -sI http://work.ministry.uz | head -1                                    # 308

# 4. Security headers are present on the SPA document (HSTS, CSP, frame-ancestors none).
curl -skI https://work.ministry.uz | grep -iE 'strict-transport|content-security|x-frame'

# 5. Source maps are NOT served.
curl -sk -o /dev/null -w '%{http_code}\n' https://work.ministry.uz/assets/index.js.map   # 404

# 6. The app is not indexable.
curl -sk https://work.ministry.uz/robots.txt

# 7. Every container is healthy, none is restarting.
sudo -u devon docker compose -f infra/docker-compose.prod.yml ps

# 8. Uploads are actually scanned.
sudo -u devon docker compose -f infra/docker-compose.prod.yml exec clamav clamdcheck.sh
```

Then, in a browser: sign in as the super admin, open the console's health page (queues, DB, storage,
Telegram, AI latency, backups), and walk one real path end to end — approve a department request,
join it as a second account, move one card. A green `/readyz` with a board that will not accept a
card move is a deployment that is not done.

## 10. Backups, the drill, and the sentinel

`scripts/install.sh` already enabled the three timers. Confirm and then **prove them**, rather than
trusting them:

```bash
systemctl list-timers 'devon-*'
sudo -u devon bash /opt/devon/infra/backup/backup.sh          # take one now
sudo -u devon bash /opt/devon/infra/backup/verify.sh          # does it restore at all
sudo -u devon node /opt/devon/tools/backup/restore-drill.mjs  # does it restore CORRECTLY
```

The drill restores the newest backup into a scratch database and the MinIO mirror into a scratch
bucket, compares every table's row count against the manifest taken at dump time, checks the RLS
policies and the migration ledger survived, and writes a dated report under
`agentic/ledger/backups/`. A green drill on install day is what makes the first real restore
uneventful. The quarterly procedure is `docs/ops/CHECKLIST-QUARTERLY-DRILL.md`.

The **sentinel** is the host-level pause/wipe executor. It runs under systemd on the host, never in a
container, and listens on `127.0.0.1` only (ADR-011). Generate the keypair somewhere you control —
the private key must never live on this host:

```bash
node /opt/devon/infra/sentinel/scripts/keygen.mjs
sudo install -o root -g root -m 0600 /opt/devon/infra/sentinel/sentinel.conf.example /etc/devon/sentinel.conf
sudo "$EDITOR" /etc/devon/sentinel.conf        # paste the public_key line
sudo bash /opt/devon/scripts/install.sh        # picks the config up and enables the unit
node /opt/devon/infra/sentinel/scripts/prove.mjs   # four break attempts, all must be refused
```

## 11. Hand over

Finish with `docs/ops/CHECKLIST-GO-LIVE.md` — it is the sign-off, and it catches the things this
page cannot check for you (who holds the passphrase, whether anyone is alerted when a backup fails,
whether the department actually knows the address).

Keep on hand: `docs/ops/RUNBOOK.md` (every operational procedure), `docs/ops/UPDATE.md` (upgrades),
`infra/README.md` (compose profiles, TLS, sentinel, backups), `infra/k3s/README.md` (the Kubernetes
alternative).
