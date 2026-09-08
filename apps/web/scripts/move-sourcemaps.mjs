#!/usr/bin/env node
// H6.3 "source maps not public (uploaded to error tracking only)". `vite.config.ts` sets
// `build.sourcemap: command === 'build'` so every production build still emits real `.map` files
// (needed to symbolicate a production stack trace) -- the hardening baseline measured 89 of them,
// 11.2 MB total, sitting in `dist/assets` right next to the `.js` they describe, with nothing in
// this repo's static-file serving config blocking `*.map` requests (Caddyfile asset-cache-header
// changes are this item's only allowed Caddyfile edit; a `.map`-blocking route rule is out of that
// scope, and no Dockerfile/web-server config exists yet for the (not-yet-built) `web` container
// image per that file's own header comment).
//
// The fix that stays in `apps/web`'s own TOUCHES: never let the maps exist inside `dist/` (what a
// static server actually serves) in the first place. Run once, right after `vite build`, this moves
// every `dist/assets/*.map` to a sibling `dist-sourcemaps/` directory -- same filenames, so an error
// tracker's upload step (`sentry-cli`, `bugsnag-source-maps`, etc., whichever this deployment picks)
// can point at it directly. `dist/`'s own `.js` files are untouched: Vite already omits the
// `//# sourceMappingURL=` comment from a real user's response when `sourcemap: true` without
// `'hidden'`... no -- it does emit the comment either way, so removing the physical `.map` file is
// what actually stops a browser DevTools (or a scraper) from fetching one; the comment referencing a
// now-404 URL is harmless (DevTools just shows "no sourcemap found", not an error).
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = join(webRoot, 'dist', 'assets')
const outDir = join(webRoot, 'dist-sourcemaps')

if (!existsSync(assetsDir)) {
  console.warn('[move-sourcemaps] no dist/assets -- run `vite build` first, skipping')
  process.exit(0)
}

const maps = readdirSync(assetsDir).filter((f) => f.endsWith('.map'))
if (maps.length === 0) {
  console.warn('[move-sourcemaps] no .map files in dist/assets (sourcemap generation is off)')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
for (const file of maps) {
  renameSync(join(assetsDir, file), join(outDir, file))
}
console.warn(
  `[move-sourcemaps] moved ${maps.length} .map file(s) out of dist/assets -> dist-sourcemaps/`,
)
