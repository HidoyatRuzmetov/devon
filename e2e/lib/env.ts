// Shared port/URL resolution (design.md §7.4's `.env.example` variable names, read the same way
// `scripts/start.mjs` reads them). Every value has the same default as `.env.example` so this suite
// works against a clean clone with zero configuration, and against a customised `.env` when one is
// exported into the shell before `playwright test` runs (this file never reads `.env` itself --
// `apps/web`/`apps/api`'s own dev scripts already do that, and duplicating it here would risk the two
// copies drifting).
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = join(E2E_DIR, '..')

export const API_PORT = Number(process.env['API_PORT'] ?? 3000)
export const WEB_PORT = Number(process.env['WEB_PORT'] ?? 5173)
export const STORYBOOK_PORT = Number(process.env['STORYBOOK_PORT'] ?? 6006)

export const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`
export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`
export const STORYBOOK_BASE_URL = `http://127.0.0.1:${STORYBOOK_PORT}`

/** design.md §12: every qa-visual artefact this item's tooling produces lands here, named per
 * `agentic/scripts/dod.mjs:34-49` (this item's handoff, verbatim). Overridable so a local dry run can
 * point at a scratch directory instead of the real cycle ledger. */
export const QA_VISUAL_DIR =
  process.env['E2E_QA_VISUAL_DIR'] ??
  join(REPO_ROOT, 'agentic', 'ledger', 'cycles', 'EPIC-000', 'qa-visual')

/** Local, gitignored scratch space for this suite's own bookkeeping (spawned-process handles,
 * cached bootstrap credentials across a `--repeat-each` or re-run within one machine) -- never
 * evidence, never read by `dod.mjs`. */
export const TMP_DIR = join(E2E_DIR, '.tmp')

export const CI = process.env['CI'] === '1' || process.env['CI'] === 'true'

/** Whether `global-setup.ts` should attempt to bring up Postgres/Valkey (docker compose) and
 * `apps/api` at all. Defaults on; set `E2E_SKIP_BACKEND=1` to run only the routes that need no API
 * (`/login`, `/setup`'s pristine form, and every `?__state=` forced screenshot on those two routes) --
 * useful while EPIC-000's other work items (`@devon/db`'s `migrate:apply`, the demo seed) have not
 * landed yet, without this suite ever needing to change once they do. */
export const SKIP_BACKEND = process.env['E2E_SKIP_BACKEND'] === '1'

export const SKIP_STORYBOOK = process.env['E2E_SKIP_STORYBOOK'] === '1'
