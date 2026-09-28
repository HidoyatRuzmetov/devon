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

The target repository currently contains only an unrelated placeholder commit. After reviewing the
working tree and creating the local commit, publish this repository as the authoritative `main`
history with:

```bash
git push --force-with-lease -u origin main
```

Do not run that command until the intended local commit exists. There is no long-lived `dev` branch;
development and testing stay local, while successful CI on `main` is the production release gate.

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
2. API and web images are tagged with the full commit SHA and pushed to GHCR.
3. Only non-secret operational manifests are copied to `/opt/devon`.
4. The server takes an encrypted backup if a database already exists.
5. Migrations run before the new application containers.
6. `/readyz` gates success. A failed rollout restores the previous images.

Production never starts the separate `worker` Compose service on the 8 GB ECS because the API entry
point already runs the durable background loops. This avoids running the same HTTP server and loops
twice. PostgreSQL, Valkey, ClamAV, Centrifugo, API, web, and Caddy remain enabled. Uploads use the
persistent local-storage volume on the 500 GB data disk; the optional MinIO profile is not enabled.
