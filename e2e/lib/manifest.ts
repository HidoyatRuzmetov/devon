// Builds `agentic/ledger/cycles/EPIC-000/qa-visual/manifest.json` (`agentic/scripts/dod.mjs`'s DoD
// check 4/5). `dod.mjs`'s check 4 derives, *for every slug in `manifest.routes`*, the full
// `{1440,1024,390} x {light,dark} x {uz,ru}` = 12 baseline filenames and requires all of them to
// exist -- so `manifest.routes` must contain *only* the route slugs `tests/screenshots.spec.ts`'s
// baseline grid actually covers with all 12. Forced-state shots (`tests/states.spec.ts`, 2 configs x 5
// states, `__<state>` suffix) and the shell-component/storybook pseudo-routes are real, useful
// evidence but must never be added to `routes[]`, or `dod.mjs` would look for baseline combinations
// that were never meant to exist for them and report a false gap. `states_verified` is therefore a
// separate flag, set independently of `routes[]`.
//
// Playwright runs specs across several worker *processes*, so this cannot be a single in-memory
// object -- each worker records what it did as one small JSON file under `qa-visual/.manifest-parts/`,
// and `finalizeManifest()` (called once, from `playwright.config.ts`'s `globalSetup`-returned
// teardown, after every worker has exited) reduces them into the one file `dod.mjs` reads.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { QA_VISUAL_DIR } from './env.js'

const PARTS_DIR = join(QA_VISUAL_DIR, '.manifest-parts')

interface ManifestPart {
  route?: string
  statesVerified?: boolean
}

async function writePart(part: ManifestPart): Promise<void> {
  await mkdir(PARTS_DIR, { recursive: true })
  await writeFile(join(PARTS_DIR, `${randomUUID()}.json`), JSON.stringify(part), 'utf8')
}

/** Call once per route slug, only from the test that just wrote all 12 baseline-grid files for it
 * (`tests/screenshots.spec.ts`). */
export async function recordBaselineRoute(routeSlug: string): Promise<void> {
  await writePart({ route: routeSlug })
}

/** Call from `tests/states.spec.ts` once it has forced and screenshotted a kind -- sets the
 * `states_verified` flag `dod.mjs` checks, independent of `routes[]` (see this file's header). */
export async function recordStatesVerified(): Promise<void> {
  await writePart({ statesVerified: true })
}

export async function finalizeManifest(): Promise<{
  routes: string[]
  statesVerified: boolean
} | null> {
  let files: string[]
  try {
    files = await readdir(PARTS_DIR)
  } catch {
    return null // no test ever recorded anything -- nothing to finalize.
  }
  const routes = new Set<string>()
  let statesVerified = false
  for (const file of files) {
    try {
      const part = JSON.parse(await readFile(join(PARTS_DIR, file), 'utf8')) as ManifestPart
      if (part.route) routes.add(part.route)
      if (part.statesVerified) statesVerified = true
    } catch {
      // A part file that failed to write completely (killed mid-run) -- skip it rather than fail the
      // whole reduce; it will simply be missing from this run's manifest, which `dod.mjs` will then
      // correctly report as incomplete.
    }
  }
  const manifest = {
    routes: [...routes].sort(),
    states_verified: statesVerified,
    generatedAt: new Date().toISOString(),
  }
  await mkdir(QA_VISUAL_DIR, { recursive: true })
  await writeFile(join(QA_VISUAL_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await rm(PARTS_DIR, { recursive: true, force: true })
  return { routes: manifest.routes, statesVerified: manifest.states_verified }
}
