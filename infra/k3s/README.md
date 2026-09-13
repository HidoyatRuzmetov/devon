# Devon (WorkPortal) on k3s

**Qisqacha (uz-Latn).** Bu — Devonni bitta serverdagi Docker Compose o'rniga k3s (yengil Kubernetes)
klasterida ishlatish uchun manifestlar to'plami. Compose asosiy yo'l bo'lib qoladi; k3s vazirlikda
allaqachon Kubernetes bo'lsa yoki bir nechta nusxa (replica) kerak bo'lsa tanlanadi. Sirlar
`secret.yaml` faylida bo'ladi va hech qachon git'ga qo'shilmaydi. Migratsiyalar har doim yangi
podlardan **oldin** alohida Job sifatida ishga tushadi. `infra/k3s/validate.sh` manifestlarni
klastersiz ham tekshiradi.

---

Compose (`infra/docker-compose.prod.yml`, `docs/ops/INSTALL.md`) is the supported path and the one
every runbook assumes: one ministry box, no orchestrator, decision 2 in TECH-SPEC §19. This directory
is the **alternative** for a ministry that already runs Kubernetes, or that needs more than one node
for availability rather than for load.

Pick k3s only if at least one of these is true. None of them is true for the first deployment:

| Reason | Why Compose is not enough |
|---|---|
| The ministry already operates a cluster and has people who know `kubectl` | Two deployment shapes cost less than two operating models |
| The api/web tier must survive a single node failing | Compose's `restart: unless-stopped` only restarts on the node that died |
| Rollouts must be gated on readiness automatically | Compose's `depends_on: service_healthy` gates start-up, not a rolling update |

Everything else — backups, the sentinel, pause/wipe, the runbooks — is identical, because it is
about the data and the host, not the scheduler.

## What is here

```
kustomization.yaml            `kubectl apply -k infra/k3s` -- the whole default stack
namespace.yaml                namespace `devon`, Pod Security `restricted` enforced
config.yaml                   every NON-secret env var (ConfigMap devon-config)
secret.example.yaml           template for secret.yaml (never committed; .gitignore covers it)
postgres.yaml                 StatefulSet + headless Service + 20Gi PVC (single node only)
valkey.yaml                   Deployment + Service (no persistence -- holds nothing durable)
minio.yaml                    StatefulSet + Service + 50Gi PVC (object storage)
centrifugo.yaml               Deployment + Service (realtime fan-out)
api.yaml                      Deployment + Service, /healthz liveness + /readyz readiness
worker.yaml                   Deployment, no Service (pg-boss background loops)
web.yaml                      Deployment + Service (the built SPA on nginx-unprivileged :8080)
ingress.yaml                  Traefik Ingress (k3s's default controller) + cert-manager annotation
migrate-job.yaml              per-release migration Job -- NOT in the kustomization, see below
optional/traefik-middleware.yaml  security headers + CSP, transcribed from infra/Caddyfile
optional/cert-manager-issuer.yaml ACME ClusterIssuer (useless on an air-gapped network)
optional/clamav.yaml          clamd -- required whenever NODE_ENV=production
validate.sh                   render + schema-validate + (if a cluster is reachable) server dry-run
```

## Validate before you apply

```bash
infra/k3s/validate.sh
```

Runs three levels and says which it skipped. Last run on this checkout, with no cluster reachable:

```
[k3s-validate] rendered 16 resource(s)
[k3s-validate] schema-validating against Kubernetes 1.31.0 (docker kubeconform) ...
Summary: 16 resources found parsing stdin - Valid: 16, Invalid: 0, Errors: 0, Skipped: 0
Summary: 3 resources found parsing stdin - Valid: 3, Invalid: 0, Errors: 0, Skipped: 0
[k3s-validate] SKIPPED server dry-run: no reachable cluster in the current kubeconfig.
```

**`kubectl apply --dry-run=client` is not an offline check.** It resolves every kind against the API
server's discovery document, so with no cluster it prints `unable to recognize` for all sixteen
resources — which looks like a manifest error and is not one. Use `validate.sh` (kubeconform against
pinned upstream schemas) off-cluster, and `kubectl apply --dry-run=server -k infra/k3s` on the node.

## Install

1. **Install k3s** on the ministry node. Traefik and the `local-path` storage class come with it.

   ```bash
   curl -sfL https://get.k3s.io | sh -
   sudo k3s kubectl get nodes
   # For kubectl from your own machine:
   sudo cat /etc/rancher/k3s/k3s.yaml   # copy to ~/.kube/config, replace 127.0.0.1 with the node IP
   ```

2. **Build and push the three images.** The manifests reference `devon-api`, `devon-worker` and
   `devon-web`; k3s cannot pull from a laptop's local Docker daemon.

   ```bash
   docker compose -f infra/docker-compose.prod.yml build
   for i in api worker web; do
     docker tag "devon-$i:local" "registry.example.uz/devon/$i:v1.1.0"
     docker push "registry.example.uz/devon/$i:v1.1.0"
   done
   cd infra/k3s
   # Pin by digest for a real release -- a tag can be repointed by the registry, a digest cannot.
   kustomize edit set image devon-api=registry.example.uz/devon/api@sha256:...
   kustomize edit set image devon-worker=registry.example.uz/devon/worker@sha256:...
   kustomize edit set image devon-web=registry.example.uz/devon/web@sha256:...
   ```

   No registry? k3s reads images straight out of its own containerd:
   `docker save devon-api:local | sudo k3s ctr images import -` (repeat per image), and leave the
   tags at `:local` with `imagePullPolicy: IfNotPresent` (the default for a non-`:latest` tag).

3. **Create the secret.** Never commit it; `infra/k3s/.gitignore` already excludes `secret.yaml`.
   The generating command is in the header of `secret.example.yaml`.

4. **Set the real hostname** in `config.yaml` (`DEVON_PUBLIC_URL`, `STORAGE_S3_PUBLIC_ENDPOINT`,
   `CENTRIFUGO_WS_URL`) and in `ingress.yaml` (`spec.tls[].hosts`, `spec.rules[].host`). All five
   must name the same host: it is the CORS origin, the cookie domain, the base of every link in a
   notification, and the host a presigned upload URL is signed for.

5. **Apply, in this order.** The order is not cosmetic — the Ingress 503s if its middleware does not
   exist yet, and the API refuses to boot without a database that already has its migrations.

   ```bash
   kubectl apply -f infra/k3s/secret.yaml
   kubectl apply -f infra/k3s/optional/traefik-middleware.yaml
   kubectl apply -f infra/k3s/optional/clamav.yaml          # required for NODE_ENV=production
   kubectl apply -k infra/k3s
   kubectl -n devon rollout status statefulset/devon-postgres --timeout=5m

   kubectl -n devon delete job devon-migrate --ignore-not-found
   kubectl -n devon apply -f infra/k3s/migrate-job.yaml
   kubectl -n devon wait --for=condition=complete job/devon-migrate --timeout=10m

   kubectl -n devon rollout status deploy/devon-api deploy/devon-worker deploy/devon-web
   ```

6. **TLS.** With cert-manager installed, apply `optional/cert-manager-issuer.yaml` and the
   annotation on the Ingress does the rest. With a ministry-issued certificate (or no internet, so
   no ACME), drop that annotation and create the secret by hand:

   ```bash
   kubectl -n devon create secret tls devon-tls --cert=fullchain.pem --key=privkey.pem
   ```

7. **The super-admin ceremony** is the same as Compose — `docs/ops/INSTALL.md` §8. The one-time
   setup URL is loopback-gated, and a pod has no loopback you can reach, so either set
   `DEVON_SETUP_REMOTE=1` in `config.yaml` for the duration of the ceremony and set it back to `0`
   afterwards, or port-forward and keep the gate on (preferred):

   ```bash
   kubectl -n devon port-forward deploy/devon-api 3000:3000
   kubectl -n devon logs deploy/devon-api | grep -i 'setup'   # the one-time URL
   ```

## Per-release update

`scripts/update.sh --target k3s` does all of this with the checks in the right order; see
`docs/ops/UPDATE.md`. By hand:

```bash
infra/backup/backup.sh                                   # backup FIRST, always
cd infra/k3s && kustomize edit set image devon-api=...@sha256:... && cd -
kubectl -n devon delete job devon-migrate --ignore-not-found
kubectl -n devon apply -f infra/k3s/migrate-job.yaml
kubectl -n devon wait --for=condition=complete job/devon-migrate --timeout=10m
kubectl apply -k infra/k3s
kubectl -n devon rollout status deploy/devon-api --timeout=10m
```

Migrations before the rollout, never inside the pods (H18.1). Every migration is expand-then-contract
(I-15), so the old api pods keep serving correctly against the new schema for the length of the
rolling update — which is what makes this safe without downtime.

Rollback is `kubectl -n devon rollout undo deploy/devon-api` (plus `worker`/`web`). It rolls the
*code* back, never the schema: there are no down-migrations and never will be. If a release shipped
a genuinely backward-incompatible migration, the path is a restore from backup, not a schema
rollback — `docs/ops/RUNBOOK.md` → "Restore".

## External database

`postgres.yaml` is one replica on a `local-path` PVC — k3s binds that volume to whichever node it
first scheduled on, and two Postgres replicas on one volume corrupt it. For more than one node, or
where the ministry already runs managed Postgres:

1. delete `postgres.yaml` from `kustomization.yaml`'s `resources:`;
2. point the api/worker `DATABASE_URL` and the migrate Job's `MIGRATION_DATABASE_URL` at the
   external host (an `ExternalName` Service called `devon-postgres` keeps every manifest unchanged);
3. make sure `pgvector`, `pg_trgm` and `pg_stat_statements` are available there — migration
   `0000_extensions.sql` creates them and fails loudly if the server cannot;
4. adjust `infra/backup/*.sh`'s `POSTGRES_HOST` the same way. The backup path does not care whether
   Postgres runs in Compose, in a pod, or on someone else's server.

## What is deliberately NOT here

- **The sentinel** (`infra/sentinel/`) stays on the host under systemd, never in a pod. Its whole
  point is that the pause/wipe executor is reachable only from `127.0.0.1` on the host and is
  unreachable from any container (ADR-011). Putting it in the cluster would defeat it.
- **Backups.** `infra/backup/*.sh` run from the host against the database, by design — same scripts,
  same schedule, same `docs/ops/RUNBOOK.md`. On k3s point `POSTGRES_HOST` at the service (or run
  them as a CronJob using the same pinned Postgres image); the weekly restore drill
  (`tools/backup/restore-drill.mjs`) is unchanged.
- **HorizontalPodAutoscaler.** The load profile of one department — a few hundred people — does not
  need one, and an autoscaler that has never been load-tested is a liability, not a feature. Scale
  by hand (`kubectl -n devon scale deploy/devon-api --replicas=3`) once H26's numbers say so.
