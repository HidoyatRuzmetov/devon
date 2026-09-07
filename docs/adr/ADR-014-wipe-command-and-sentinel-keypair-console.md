<!-- file: docs/adr/ADR-014-wipe-command-and-sentinel-keypair-console.md -->
# ADR-014: `wipe` joins the sentinel's allow-list behind one isolated executor; the console generates and rotates its own ed25519 keypair

- **Date:** 2026-09-07   **Status:** accepted
- **Deciders:** wp-architect + wp-security   **Epic:** EPIC-013

## Context
ADR-011 (EPIC-000) built the sentinel's whole transport, signing and replay-protection pipeline but
shipped exactly one command, `noop`, with a unit test (`test/no-destructive-path.test.mjs`) proving no
destructive verb existed anywhere in `infra/sentinel/src/`. Its own "Consequences" section named the
path forward explicitly: *"Adding `wipe` in EPIC-013 is an allow-list entry plus an executor plus a
new ADR — the transport, signing and replay protection are already proven here."* TECH-SPEC §11 and
the EPIC-013 task brief require: a super-admin console ceremony (typed phrase, password re-entry, 2FA
if enabled, a 60-second cancellable countdown, all server-verified) that ends in a signed `wipe`
command; a host CLI (`devon-wipe --confirm`) for the same command without the console; and a Windows
service script alongside the existing systemd unit.

The signing key is asymmetric (ed25519): the sentinel only ever holds the **public** key
(`/etc/devon/sentinel.conf`, 0600 root); the private key must live wherever commands are signed and
never in this repository, an `.env` file, or the application image. `keygen.mjs`'s own header comment
already anticipated this epic generating a keypair itself: *"or, from EPIC-013, the super admin
console."*

## Decision
**One executor, one exclusion.** `infra/sentinel/src/wipe-executor.mjs` is the only file under `src/`
allowed to reference `docker`/`rm`/`unlink`/`volume` — `test/no-destructive-path.test.mjs` now asserts
this in both directions: every *other* file in `src/` stays clean (ADR-011's original guarantee,
narrowed rather than dropped), and `wipe-executor.mjs` itself is proved to actually contain the
capability (so the exclusion can never go vacuous by the file being emptied or renamed). It runs
`docker compose -f <composeFile> down --volumes --rmi all` (a non-fatal step — an already-stopped
stack is not an error), then `rm`s the configured `projectRoot` tree outright, then appends one line —
`wiped at <ISO time> by <actor>` — to a dedicated `/var/log/devon-wipe.log` (`SENTINEL_WIPE_LOG_PATH`
on Windows), distinct from the sentinel's own per-request log. `server.mjs` dispatches to it only after
the full, unchanged verification order (peer → size → parse → signature → freshness → nonce → allow-
list) has already passed; the executor itself re-validates nothing, by design — one call site, one
job. `config.mjs`'s `allowedCommands` becomes `['noop', 'wipe']`, still fixed in code, never read from
the conf file.

**`actor` rides along unsigned.** The wire contract's signed fields stay exactly `{v, command, nonce,
issued_at}` (ADR-011, unchanged) — widening the signed envelope for every command just to attribute one
log line was worse than the alternative: an optional `actor` string field, validated for type but
excluded from the canonical JSON that is signed, logged verbatim (sanitised: newlines stripped,
truncated to 120 chars) and never consulted for the authorization decision, which is already final by
the time it is read. A forged `actor` can lie in a log line; it cannot forge a wipe.

**The console generates its own keypair.** `POST /api/v1/admin/sentinel/rotate-key` calls
`generateKeyPairSync('ed25519')` (the same call `keygen.mjs` makes for local/manual use) and returns
the **public** key raw (`x`, base64url) for the operator to paste into `sentinel.conf` — displayed
plainly and re-readable any time via `GET /admin/sentinel/status`, never a "shown once" secret, because
a public key is not one. The **private** key (`d`) is AES-256-GCM–encrypted at rest
(`modules/admin/crypto.ts`, HKDF-derived from the existing `CSRF_SECRET`, its own purpose string — no
new `.env` entry) in a new `app.sentinel_keys` row and is never returned to the browser at all. Wipe
execution decrypts it server-side, signs `{v:1, command:'wipe', nonce, issued_at}` exactly as
`scripts/client.mjs` does, and POSTs to the sentinel over loopback HTTP with a 5-second timeout.
Rotating deactivates the previous row (a partial unique index enforces at most one active key) rather
than deleting it, so a mid-rotation race can never sign with a half-written key.

**The console ceremony enforces its own timing, server-side.** `POST /wipe/start` verifies the typed
phrase (`WIPE <user count> <DEMO|PROD>`, computed server-side so it always matches the instance it
names), the password, and — only if 2FA is enabled — the TOTP code, then writes a `countdown` row with
`countdown_ends_at = now() + 60s`. `POST /wipe/execute` re-checks `countdown_ends_at <= now()` itself
before ever calling the sentinel — the 60 seconds is a database fact, not a client-side timer's
promise, so a crafted early "execute" call is a no-op, not a bypass. `POST /wipe/cancel` is available
the whole time the countdown row says `countdown`. The host CLI (`devon-wipe.mjs --confirm`, reading a
`keygen.mjs`-format key file or `SENTINEL_PRIVATE_KEY`/`SENTINEL_PUBLIC_KEY`) skips the console
ceremony by design (an operator with host filesystem access already has an equivalent blast radius)
but still refuses to run without `--confirm`.

**Windows gets a service script, not parity.** `infra/sentinel/windows/install-service.ps1` registers
a plain `sc.exe` service (no NSSM/`node-windows` dependency, matching ADR-011's "dependency-free by
design") and persists the sentinel's config/log paths as **machine-scoped** environment variables
(`[Environment]::SetEnvironmentVariable(..., 'Machine')`), not session-local ones — a service process
spawned by the SCM at boot never inherits an installer script's own `$env:` block. The script says so
plainly: Node does not implement the Windows Service Control Protocol, so `sc stop` terminates the
process rather than draining it the way systemd's `SIGTERM` handling does.

## Consequences
- Positive: the wipe capability exists in exactly one small, grep-provable file, exactly as ADR-011
  promised it would if this day came; the private signing key never crosses the browser boundary; the
  60-second wait is a server-verified fact, immune to a client that lies about elapsed time; the public
  key's "not actually secret" nature is reflected in the UI instead of a false "shown once" ceremony
  that would only train operators to click through it.
- Negative / debt accepted: the systemd unit's capability set (`CAP_DAC_OVERRIDE`,
  `CAP_DAC_READ_SEARCH`, `CAP_FOWNER`, plus Docker-socket read/write in `ReadWritePaths`) is a genuine
  widening from ADR-011's empty bounding set and has not been exercised against a real Linux host in
  this session — flagged for a security reviewer to verify on the target OS before production use,
  rather than assumed correct from the unit file's text alone. The Windows service script is similarly
  unverified against a real Windows Server host (syntax-reviewed only). `actor` attribution in
  `/var/log/devon-wipe.log` is informational, not evidentiary — the audit trail of record for "who
  actually authorized this" is `audit.events` (`admin.wipe.started`/`completed`/`failed`), which does
  carry a verified actor.
- Migration / rollback path: `systemctl stop devon-sentinel` (or the Windows service equivalent) removes
  the capability with no state loss, identical to ADR-011. Reverting `wipe` from the allow-list is a
  one-line change plus restoring `no-destructive-path.test.mjs`'s original unconditional assertion — the
  new commit history documents exactly what to revert to.

## Alternatives considered
- Deleting `/etc/devon/sentinel.conf`'s public key as the "uninstall" story instead of a systemd/SCM
  stop: rejected — it still leaves the executable and a stopped-but-present service, more confusing
  than "stop the service," and the sentinel refuses to start at all without a public key anyway (fail
  closed, ADR-011), so an operator who deletes it accidentally gets the same effect without meaning to.
- Signing `actor` as part of the canonical envelope: rejected in favour of leaving it unsigned and
  purely advisory (see Decision) — it would have meant every future command's signed shape carries a
  field most commands (like `noop`) have no use for, for an attribution guarantee the audit log already
  provides more strongly.
- A single generic `destroy` command instead of a wipe-specific name: rejected — `wipe` matches the
  product's own vocabulary (TECH-SPEC §11 "wipe switch") end to end, console copy included, and a
  generic name buys nothing since the allow-list is fixed in code either way.
