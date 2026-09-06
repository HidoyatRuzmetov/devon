// Auto-discovers domain modules under `src/modules/<name>/index.ts` and hands `app.ts` a plugin +
// prefix to register for each (MODULE-GUIDE.md "API modules"). A directory becomes a module by
// existing and exporting a default Fastify plugin -- nothing here, and nothing in `app.ts`, needs to
// change when a module is added or removed, which is the whole point: several agents can each add a
// module directory in parallel without touching this file or each other's.
//
// `readdirSync` (not a static import list) is the discovery mechanism; the result is sorted
// alphabetically by directory name so registration order -- and therefore the order any
// prefix-collision error surfaces in -- is identical on every machine and in CI, never dependent on
// filesystem iteration order.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

export type ApiModule = {
  /** The directory name under `src/modules/`, e.g. `"auth"`. Used only for error messages and the
   * deterministic sort -- never assumed to equal the route prefix (see `instance`/`setup`/`me`,
   * which mount at bare `/api/v1`, and `auth`/`admin`, which add their own segment). */
  name: string
  plugin: FastifyPluginAsyncZod
  /** Appended verbatim to `/api/v1`. A module's own `index.ts` owns this -- `''` for a module that
   * mounts directly under `/api/v1` (its routes then start with their own `/whatever`), or `'/foo'` for
   * one that wants everything under `/api/v1/foo`. Defaults to `''` when a module exports none. */
  prefix: string
}

const DEFAULT_MODULES_DIR = fileURLToPath(new URL('./modules', import.meta.url))

function hasIndexFile(dir: string): boolean {
  return existsSync(join(dir, 'index.ts')) || existsSync(join(dir, 'index.js'))
}

/**
 * Reads every subdirectory of `dir` (default: `src/modules`) that contains an `index.ts`/`index.js`,
 * dynamically imports it, and returns its plugin + prefix in deterministic (alphabetical) order.
 * Core, non-domain plugins that do not live under `/api/v1` at all (health checks, the OpenAPI
 * document) simply are not modules in this sense -- `app.ts` registers those two by hand, same as
 * always; this loader only ever sees directories, so nothing needs to exclude them by name.
 */
export async function loadApiModules(dir: string = DEFAULT_MODULES_DIR): Promise<ApiModule[]> {
  if (!existsSync(dir)) return []

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && hasIndexFile(join(dir, entry.name)))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const modules: ApiModule[] = []
  for (const name of names) {
    // A `.js` specifier that resolves to a sibling `.ts` file at runtime -- the same convention every
    // static import in this codebase already relies on under `tsx`/vitest in dev and test, and that
    // resolves to the real compiled `.js` once `tsc` has run for `node dist/server.js` in production.
    // `@vite-ignore`: vitest runs this file through Vite, which otherwise refuses to statically analyse
    // a template-literal specifier (it wants a glob for that) -- this is a plain runtime `import()`,
    // not something that needs Vite's module graph.
    const imported = (await import(/* @vite-ignore */ `./modules/${name}/index.js`)) as {
      default?: FastifyPluginAsyncZod
      prefix?: string
    }
    if (!imported.default) {
      throw new Error(
        `api module loader: "src/modules/${name}/index.ts" has no default export (expected a Fastify plugin)`,
      )
    }
    modules.push({ name, plugin: imported.default, prefix: imported.prefix ?? '' })
  }
  return modules
}
