# Work item: EPIC-000.8 infra/: Compose profiles, Caddyfile, sentinel skeleton, backup scripts

- **Epic:** EPIC-000   **Owner:** wp-devops
- **Depends on:** EPIC-000.1   **Parallel-safe:** yes
- **Covers:** AC-15, AC-1
- **Class:** C (wp-security mandatory on review)

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `infra/docker-compose.yml`
- `infra/Caddyfile`
- `infra/sentinel/**`
- `infra/backup/**`
- `infra/README.md`

## DOES NOT
- touch `.github/workflows/ci.yml` (EPIC-000.1 owns it; EPIC-000.10 may add only the nightly job)
- implement any wipe or pause execution path — the sentinel accepts `noop` only, by design (AC-15 disproof)

## Handoff contract
Compose starts only `postgres` and `valkey` by default (host ports 55432/56379, overridable); `caddy`, `minio`, `centrifugo`, `clamav`, `pgbackrest`, `glitchtip` sit behind `profiles:` and are not started by `pnpm setup`/`pnpm start`. Images pinned by digest.
```
POST http://127.0.0.1:8787/command   Content-Type: application/json  (≤4096 bytes)
{ "v":1, "command":"noop", "nonce":"<64 hex>", "issued_at":"<ISO>", "sig":"<base64url ed25519 over canonicalJson({v,command,nonce,issued_at})>" }
200 {"ok":true,...} | 400 malformed/unknown_command | 401 bad_signature/expired/replay | 403 forbidden | 413 too_large
GET /healthz → 200 {"ok":true,"commands":["noop"]}
```
Verification order, fixed: peer address → size → parse → signature → freshness (|now−issued_at| ≤ 60s) → nonce unseen (retention 300s) → command allow-list. Bind `127.0.0.1` explicitly AND independently check peer address per request. Public key only in `/etc/devon/sentinel.conf` (mode 0600, root-owned); private key never lives in this repo. No destructive command path exists in this epic's sentinel code.

## Done when
- gates profile `item` green
- `wp-reviewer` and `wp-security` have no open SEV1/SEV2
- evidence: four break attempts (non-loopback caller, unsigned, wrong key, replay) each rejected, pasted with `ss -ltnp` showing loopback-only bind
