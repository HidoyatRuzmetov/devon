# Devon (WorkPortal) -- production image for `apps/web` (H17 build, H18 deployment).
# Build from the REPO ROOT (pnpm workspace):
#   docker build -f apps/web/Dockerfile -t devon-web:<tag> .
#
# Unlike apps/api, this one IS a real, minimal production artifact: `vite build` fully bundles
# `@devon/contracts`/`@devon/i18n`/`@devon/ui` (esbuild/Rollup read their TS source directly -- no
# runtime import resolution involved, unlike Node loading `@devon/db` at process start) into static
# JS/CSS under apps/web/dist. The runtime stage ships nothing but those static files plus a tiny
# non-root static file server -- no Node, no node_modules, no source, in the final image at all.
#
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

FROM ${NODE_IMAGE} AS build
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --network-concurrency=8 --fetch-timeout=120000
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY packages/i18n packages/i18n
COPY packages/ui packages/ui
COPY apps/web apps/web
# No `.env` is present in a Docker build context (H1.1 -- secrets never in the repo, and this file's
# COPY list above never includes one); `apps/web/src/vite.config.ts`'s own `loadEnv()` call tolerates
# a missing file and falls back to `process.env`/defaults -- pass build-time public config with
# `--build-arg`-sourced `ENV` lines here if a deployment ever needs a non-default `VITE_`/`DEVON_`
# value baked into the bundle (none are required today: the SPA reads `/api/v1/instance` at runtime
# for everything environment-specific, per TECH-SPEC).
RUN pnpm --filter @devon/web build

FROM ${NGINX_IMAGE} AS runtime
# nginx 1.30.6 fixes CVE-2026-15176, CVE-2026-93479 and CVE-2026-97205, with matching
# upstream modules. Patch remaining libraries and restore the non-root user afterwards.
USER root
# CVE-2026-111497 / CVE-2026-92392: the pinned upstream image predates these library fixes.
RUN apk add --no-cache tiff=4.7.2-r0 libexpat=2.9.0-r0 libx11=1.8.14-r0 \
    brotli-libs=1.2.1-r0 curl=8.23.0-r0 libcurl=8.23.0-r0
USER 101
# `nginx-unprivileged` already runs its worker AND master process as the `nginx` user (uid 101) on an
# unprivileged port -- a real non-root container, not just non-root worker processes behind a root
# master (H17.1/H18.1). Caddy's `infra/Caddyfile` proxies to `web:8080` (not `:80`) to match.
COPY infra/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O- http://127.0.0.1:8080/ >/dev/null || exit 1
