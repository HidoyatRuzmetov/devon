// Auto-discovers demo-seed modules under `src/seed/modules/<name>.ts` (MODULE-GUIDE.md "Seeds"). Each
// file exports `{ order, seed(ctx), reset?(ctx) }`; `demo.ts`'s `runSeedDemo` calls every discovered
// module's `seed()`, in ascending `order`, inside the one transaction/advisory-lock/checksum wrapper it
// already owns -- a module never opens its own connection or does its own locking -- and `runResetDemo`
// calls every module's `reset()` in *descending* `order` (children before the parents they point at)
// before deleting `core.ts`'s own rows. `order` is a plain number, not a convention over filenames, so
// two modules can share a tier (both `100`) and still sort deterministically against each other (by
// name, as a tiebreak) without either one caring what the other picked.
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Tx } from '../context.js'
import type { DemoScope } from './reset-sweep.js'

export type SeedModuleContext = { tx: Tx }

export type SeedModule = {
  /** Sort key, ascending. `core.ts` (users/departments/memberships -- the rows every other module's
   * fixtures point at) is `0`; a module that references the demo department picks something higher. */
  order: number
  /** Writes this module's slice of the demo dataset (`ON CONFLICT DO NOTHING`-safe, like `core.ts`)
   * and returns the number of rows it actually wrote -- summed by `runSeedDemo` into the total the
   * seed:demo CLI prints. */
  seed(ctx: SeedModuleContext): Promise<number>
  /** Deletes exactly the rows this module's `seed()` writes -- matched by the same deterministic
   * `demoId(...)` ids, children before parents within the module -- and returns the number of rows it
   * actually deleted (summed by `runResetDemo`). Optional only for a module whose rows are already
   * covered by `fixtures.ts`'s `DEMO_DELETE_ORDER` (today: `core.ts`); every module that writes a row
   * of its own must implement it, or `seed:reset --demo` leaves that row behind. Runs inside the same
   * shared transaction as `seed()`, under the same `demoContext()`: a module whose rows live in another
   * department or are owner-only under RLS re-points the GUC with `scope.ts`'s `asDepartment`/`asUser`
   * exactly as its `seed()` did to write them. */
  reset?(ctx: SeedModuleContext): Promise<number>
  /** The departments and users *this module creates*, if any. `demo.ts` unions every module's scope
   * with the foundation's and hands the result to `reset-sweep.ts`, which is what makes
   * `seed:reset --demo` survive a database people have actually demonstrated from -- see that file's
   * header. A module that creates neither (most of them) omits this. */
  scope?: DemoScope
}

/** A discovered module plus its filename. `demo.ts` folds the set of names into the run fingerprint,
 * so adding a seed module is by itself enough to make an already-seeded database seed the new rows. */
export type LoadedSeedModule = SeedModule & { name: string }

const DEFAULT_MODULES_DIR = fileURLToPath(new URL('./modules', import.meta.url))

/**
 * Reads every `*.ts`/`*.js` file directly under `dir` (default: `src/seed/modules`), imports it, and
 * returns the modules sorted by `order` ascending (ties broken by filename so the order is still
 * deterministic). Throws if a file's shape does not match `SeedModule` -- a seed module with a typo in
 * `order`/`seed` should fail loudly at `seed:demo` time, not silently seed nothing.
 */
export async function loadSeedModules(
  dir: string = DEFAULT_MODULES_DIR,
): Promise<LoadedSeedModule[]> {
  if (!existsSync(dir)) return []

  const names = readdirSync(dir)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.(ts|js)$/, ''))
    .sort((a, b) => a.localeCompare(b))

  const modules: Array<{ name: string; mod: SeedModule }> = []
  for (const name of names) {
    // `@vite-ignore`: this file is imported by vitest (Vite) as well as run directly under tsx/node;
    // Vite otherwise refuses to statically analyse a template-literal dynamic import specifier (see
    // `apps/api/src/module-loader.ts` for the identical situation and reasoning).
    const imported = (await import(
      /* @vite-ignore */ `./modules/${name}.js`
    )) as Partial<SeedModule>
    if (typeof imported.order !== 'number' || typeof imported.seed !== 'function') {
      throw new Error(
        `seed module loader: "src/seed/modules/${name}.ts" must export { order: number, seed(ctx) }`,
      )
    }
    if (imported.reset !== undefined && typeof imported.reset !== 'function') {
      throw new Error(
        `seed module loader: "src/seed/modules/${name}.ts" exports a non-function reset -- it must be reset(ctx) or absent`,
      )
    }
    modules.push({ name, mod: imported as SeedModule })
  }

  return modules
    .sort((a, b) => a.mod.order - b.mod.order || a.name.localeCompare(b.name))
    .map(({ name, mod }) => ({ ...mod, name }))
}
