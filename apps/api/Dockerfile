# Devon (WorkPortal) -- production image for `apps/api` (H17 build, H18 deployment).
#
# Build from the REPO ROOT (pnpm workspace -- a single package cannot be `pnpm install`ed in
# isolation because of `workspace:*` deps and the shared lockfile):
#   docker build -f apps/api/Dockerfile -t devon-api:<tag> .
#
# Workspace packages export TypeScript source. The production dependency graph includes tsx,
# which executes the API and the deployment migration CLI; TypeScript, test runners, package
# managers and build caches are not runtime dependencies. CI typechecks before image creation.
# Keep /repo/apps/api/node_modules/.bin/tsx and /repo/packages/db/src/cli-migrate.ts compatible
# with scripts/remote-deploy.sh until the migration entrypoint is deliberately changed together.
#
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS base
# Corepack ships with Node 22 but its shipped pnpm shim needs enabling once; pin the exact pnpm the
# repo declares (`package.json#packageManager`) rather than trusting whatever corepack defaults to.
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate
WORKDIR /repo

# --- deps: install production workspace dependencies from the lockfile (cached while only source, not
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
RUN pnpm install --frozen-lockfile --prod

# --- runtime: only what `tsx src/server.ts` needs at process-start, nothing from apps/web/e2e/docs. --
FROM ${NODE_IMAGE} AS runtime
WORKDIR /repo
# Runtime has no package managers or their bundled dependency trees.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-v* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
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
# server.ts registers graceful SIGTERM/SIGINT shutdown: close Fastify, stop workers and drain
# the database pool within 25 seconds. Compose allows 30 seconds before forcing termination.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
