# GitHub-to-production deployment

Devon has one deployed environment. Local development is performed with `pnpm start --demo`; a
successful CI run for `main` publishes immutable images and deploys them to the production ECS.

## Repository boundary

The following are intentionally excluded from Git and Docker build contexts:

- `.env` and every `.env.*` file except `.env.example`
- private keys, certificates with private material, and deployment-secret directories
- `node_modules`, build output, coverage, Playwright output, local data, logs, and backups

Before every first push, run:

```bash
git status --short
if git ls-files \
  | grep -Ev '(^|/)\.env\.example$' \
  | grep -Eq '(^|/)(node_modules|dist|coverage|\.data)(/|$)|(^|/)\.env($|\.)|\.(pem|key|p12|pfx|ppk)$'; then
  echo 'Refusing to push generated output or secret-bearing files' >&2
  exit 1
fi
node agentic/scripts/check-secrets.mjs
```

Publish reviewed changes through a pull request, wait for CI, and merge into `main`.
For an authorized direct release, fetch first and use a normal fast-forward push:

```bash
git fetch origin
git push origin main
```

Never replace the remote history to deploy. Successful CI for the exact current `main` commit is
the production release gate, including manually retried deployments.

## Required GitHub Actions secrets

Add these encrypted repository-level Actions secrets. The workflow still targets the `production`
environment so deployment history is grouped separately; GitHub creates that environment on the
first run if it does not already exist.

| Secret | Value |
|---|---|
| `PROD_HOST` | ECS Elastic IP address |
| `PROD_PORT` | `22` (optional; 22 is the workflow default) |
| `PROD_USER` | Deployment-only server account: `devon` |
| `PROD_SSH_KEY` | Private half of the deployment-only Ed25519 key |
| `PROD_SSH_KNOWN_HOSTS` | Pinned `ssh-keyscan -H <EIP>` line verified against the server fingerprint |

The application `.env` is installed directly on the ECS as `/opt/devon/.env` with mode `0600`. It
is never a GitHub secret and is never replaced by a deployment. GitHub's short-lived workflow token
is used only to authenticate the server to GHCR for the current image pull.

The deployment-only private key is generated locally under the ignored `deploy-secrets/` directory.
Its public half is installed for the restricted `devon` server account; its private half is stored
only as `PROD_SSH_KEY`. It is separate from the administrator key used for interactive maintenance.

The operator's Windows OpenSSH config may use the short alias `ssh devon`; that alias connects as
the Ubuntu image's administrative account with the separate `devon-prod-admin` key. It is unrelated
to GitHub Actions' deployment-only `devon` account even though the short local alias has the same
human-friendly name.

## Release behavior

1. CI's integration profile must pass for `main`.
2. API and web images are built, scanned for fixable high/critical vulnerabilities, tagged with the
   full commit SHA, and pushed to GHCR. The workflow checks again that `main` has not advanced.
3. Only non-secret operational manifests are copied to `/opt/devon`.
4. The server takes an encrypted backup if a database already exists.
5. Migrations run before the new application containers.
6. Caddy is recreated to load the installed proxy file, even when its image/Compose settings did not
   change. Certificate volumes remain persistent; expect a brief proxy interruption during this step.
7. `/readyz` gates success. A failed rollout restores previous application images, the Compose
   manifest and proxy file, then recreates Caddy to load the restored configuration.

Production never starts the separate `worker` Compose service on the 8 GB ECS because the API entry
point already runs the durable background loops. This avoids running the same HTTP server and loops
twice. PostgreSQL, Valkey, ClamAV, Centrifugo, API, web, and Caddy remain enabled. Uploads use the
persistent local-storage volume on the 500 GB data disk; the optional MinIO profile is not enabled.

## Backup monitoring and recovery

`BACKUP_STORAGE_VOLUME=devon_api_storage` includes uploaded files alongside the encrypted database
dump. The successful backup publishes only timestamp and size to `/var/lib/devon/backup-status`;
the API reads that directory read-only and cannot read the backup archives or their passphrase.
The weekly restore drill decrypts and restores both artifacts into disposable scratch locations,
then checks migrations, table counts, and row-security policies.

This installation deliberately keeps backups on the local data disk (operator decision, 2026-10-06).
It does not claim protection against loss of the entire server. `BACKUP_MIRROR_TO_MINIO=1` is a
separate opt-in; having old MinIO credentials alone does not activate mirroring.

## Dependency automation

Renovate requires the repository-level `RENOVATE_TOKEN` secret. Use a fine-grained token restricted
to `devon`, with write permissions for Contents, Pull requests, Issues, Commit statuses, and
Workflows, and read permission for Dependabot alerts. Record its expiry and rotate it before that
date. The workflow reports a specific configuration error when the secret is missing; it does not
substitute a token whose pull requests would fail to trigger CI.
