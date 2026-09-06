<!-- file: docs/adr/ADR-001-monorepo-pins.md -->
# ADR-001: pnpm + Turborepo monorepo, `@devon/*` scope, exact version pins, script parity

- **Date:** 2026-09-06   **Status:** accepted
- **Deciders:** wp-architect   **Epic:** EPIC-000

## Context
`agentic/gates.json` is hook-protected and names packages literally: `pnpm --filter @devon/db migrate:verify`, `pnpm --filter @devon/web test:e2e`, `pnpm --filter @devon/web test:a11y`, `pnpm --filter @devon/ai evals`, plus `pnpm -w --if-present security:scan` and `perf:check`. Four gates use `pnpm -r --if-present`, which passes vacuously when no package defines the script — AC-14's disproof calls that out by name. TECH-SPEC §1.2 pins every library exactly (no `^`) with provenance checks in CI.

## Decision
One pnpm workspace with Turborepo. Package scope is **`@devon/`** and the names `@devon/db`, `@devon/web`, `@devon/ai` are fixed by `gates.json`, not by preference. Every workspace package declares `typecheck`, `lint`, `test:unit`, `build` even when the body is trivial; the workspace root declares `security:scan` (Semgrep OWASP + Trivy fs) and `perf:check` (Lighthouse CI + k6). `packages/config/test/workspace-scripts.test.ts` reads `pnpm-workspace.yaml` and fails the `unit` gate if any package is missing one of the four — so the `unit` gate is what proves the other gates are not vacuous. All dependency versions are exact, `packageManager` pins pnpm for corepack, and `node setup.mjs` exists at the repo root so a machine with only Node can bootstrap.

## Consequences
- Positive: `--if-present` can never silently no-op; renaming a package is a gate failure, not a mystery; a clean clone works with Node and Docker alone.
- Negative / debt accepted: trivial script bodies in packages that have nothing to build; Renovate must be self-hosted and configured to keep exact pins rather than ranges.
- Migration / rollback path: package renames require a `gates.json` change, which is an escalation, not an edit — so renames are effectively frozen. Accepted.

## Alternatives considered
- Nx: rejected — heavier and more opinionated than a 9-package repo needs.
- npm/yarn workspaces: rejected — `gates.json` commands are pnpm-specific.
- Loosening `--if-present` by editing `gates.json`: refused — gates are never weakened by an agent (PROTOCOL §3).
