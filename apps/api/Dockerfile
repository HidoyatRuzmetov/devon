# Devon (WorkPortal) -- production image for `apps/api` (H17 build, H18 deployment).
#
# Build from the REPO ROOT (pnpm workspace -- a single package cannot be `pnpm install`ed in
# isolation because of `workspace:*` deps and the shared lockfile):
#   docker build -f apps/api/Dockerfile -t devon-api:<tag> .
#
# Why this runs via `tsx`, not compiled `dist/*.js`, in production (documented, not hidden):
# `apps/api` itself compiles cleanly (`tsc -p tsconfig.json` -> `dist/`), but every workspace package
# it imports (`@devon/db`, `@devon/contracts`, `@devon/ai`) declares `"exports": {".": "./src/index.ts"}`
# -- TypeScript source, with no built `dist` published in its `exports` map. A plain `node dist/
# server.js` in a *pruned* production install therefore cannot resolve `import ... from '@devon/db'`
# at all (there is no dist for it to find). `pnpm start`/`scripts/start.mjs` never exercises the
# `tsc`-then-`node` path either -- every environment today runs through `tsx` (`turbo run dev` ->
# `tsx watch src/server.ts`), so shipping the identical, already-proven-in-CI execution path in
# production is the honest choice here rather than a from-scratch, untested compiled-JS boot path.
# Fixing this properly is an `apps/api`+`packages/*` change (give every workspace package a real
# `build` + a `dist`-pointing `exports` map) that is out of this package's edit scope (ops-tooling
# only touches infra/, tools/, docs/ops/, Dockerfiles, scripts/, and root `package.json` scripts) --
# flagged in `agentic/ledger/hardening/2026-09-08T06-45-00-05-00/ops-tooling.md` for a follow-up
# package to pick up. Running via `tsx` means `devDependencies` stay in the runtime image (`tsx`,
# `typescript`); this image is therefore not minimal, but it is real and it boots.
#
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_IMAGE} AS base
# Corepack ships with Node 22 but its shipped pnpm shim needs enabling once; pin the exact pnpm the
# repo declares (`package.json#packageManager`) rather than trusting whatever corepack defaults to.
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate
WORKDIR /repo

# --- deps: install the full workspace's dependencies from the lockfile (cached while only source, not
#     package.json/pnpm-lock.yaml, changes). ---------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/ui/package.json packages/ui/package.json
# `--frozen-lockfile`: a production image must never silently resolve a different dependency tree than
# the one CI's gates tested (H18.1 reproducible builds). Every workspace package's manifest is copied
# above so pnpm's workspace linker sees the whole graph even though only apps/api's code follows.
RUN pnpm install --frozen-lockfile

# --- runtime: only what `tsx src/server.ts` needs at process-start, nothing from apps/web/e2e/docs. --
FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -g 10001 -S devon && adduser -u 10001 -S devon -G devon
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/package.json ./package.json
COPY --from=deps /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/ai packages/ai
COPY packages/i18n packages/i18n
COPY apps/api apps/api
# Each workspace package's OWN `node_modules` (pnpm symlinks into the root `.pnpm` store for that
# package's specific deps -- `shamefullyHoist: false` in pnpm-workspace.yaml means these are not
# optional) -- overwriting the plain source copy above with source+node_modules together.
COPY --from=deps /repo/packages/config/node_modules packages/config/node_modules
COPY --from=deps /repo/packages/contracts/node_modules packages/contracts/node_modules
COPY --from=deps /repo/packages/db/node_modules packages/db/node_modules
COPY --from=deps /repo/packages/ai/node_modules packages/ai/node_modules
COPY --from=deps /repo/packages/i18n/node_modules packages/i18n/node_modules
COPY --from=deps /repo/apps/api/node_modules apps/api/node_modules
WORKDIR /repo/apps/api
# Storage's `local` driver writes under this directory (STORAGE_LOCAL_DIR, apps/api/src/config.ts) --
# owned by the non-root user so it is writable without a root-owned bind mount workaround.
RUN mkdir -p .data/storage && chown -R devon:devon /repo/apps/api/.data
USER devon:devon
EXPOSE 3000
# `/healthz` (apps/api/src/modules/health.ts) is public and unauthenticated by design -- exactly what
# a container healthcheck needs, no credentials to bake in. `wget` ships in the alpine base already.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O- http://127.0.0.1:3000/healthz || exit 1
# Graceful shutdown (H18.1) -- KNOWN GAP, verified empirically while building this image (`docker
# stop` a running container, exit code 143): `apps/api/src/server.ts` registers no `process.on
# ('SIGTERM', ...)` handler at all, so Node's own default disposition for an unhandled SIGTERM tears
# the process down immediately -- Fastify's `close()` and the outbox/reminder/upload-sweep timers'
# `onClose` stop hooks never run. This is *safe* (not silently corrupting): every one of those loops
# is written to tolerate being killed mid-cycle and resumed cold (`events-worker.ts`'s `for update
# skip locked`, `reminder-worker.ts`'s fired-guarded `update ... returning id`) -- but it is not
# *graceful*: an in-flight HTTP request gets no drain window and is simply cut off. Fixing this needs
# a `process.on('SIGTERM', ...)` handler in `apps/api/src/server.ts` that awaits `app.close()` before
# exiting, which is out of this package's edit scope (ops-tooling touches infra/, tools/, docs/ops/,
# Dockerfiles, scripts/, not `apps/api/src`) -- flagged in `agentic/ledger/hardening/
# 2026-09-08T06-45-00-05-00/ops-tooling.md` for a follow-up package. `stop_grace_period` in
# infra/docker-compose.prod.yml is set generously anyway, in case that handler lands later.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
