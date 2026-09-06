// Auto-discovers demo-seed modules under `src/seed/modules/<name>.ts` (MODULE-GUIDE.md "Seeds"). Each
// file exports `{ order, seed(ctx) }`; `demo.ts`'s `runSeedDemo` calls every discovered module's
// `seed()`, in ascending `order`, inside the one transaction/advisory-lock/checksum wrapper it already
// owns -- a module never opens its own connection or does its own locking. `order` is a plain number,
// not a convention over filenames, so two modules can share a tier (both `100`) and still sort
// deterministically against each other (by name, as a tiebreak) without either one caring what the
// other picked.
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Tx } from '../context.js'

export type SeedModuleContext = { tx: Tx }

export type SeedModule = {
  /** Sort key, ascending. `core.ts` (users/departments/memberships -- the rows every other module's
   * fixtures point at) is `0`; a module that references the demo department picks something higher. */
  order: number
  /** Writes this module's slice of the demo dataset (`ON CONFLICT DO NOTHING`-safe, like `core.ts`)
   * and returns the number of rows it actually wrote -- summed by `runSeedDemo` into the total the
   * seed:demo CLI prints. */
  seed(ctx: SeedModuleContext): Promise<number>
}

const DEFAULT_MODULES_DIR = fileURLToPath(new URL('./modules', import.meta.url))

/**
 * Reads every `*.ts`/`*.js` file directly under `dir` (default: `src/seed/modules`), imports it, and
 * returns the modules sorted by `order` ascending (ties broken by filename so the order is still
 * deterministic). Throws if a file's shape does not match `SeedModule` -- a seed module with a typo in
 * `order`/`seed` should fail loudly at `seed:demo` time, not silently seed nothing.
 */
export async function loadSeedModules(dir: string = DEFAULT_MODULES_DIR): Promise<SeedModule[]> {
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
    modules.push({ name, mod: imported as SeedModule })
  }

  return modules
    .sort((a, b) => a.mod.order - b.mod.order || a.name.localeCompare(b.name))
    .map(({ mod }) => mod)
}
