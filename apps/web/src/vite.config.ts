import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { robotsTxtPlugin } from './lib/robots-plugin.js'

// Lives under `src/` (not a package-root `vite.config.ts`) so it stays inside this item's `TOUCHES`
// (`apps/web/src/**`) -- mirrors the convention already used by `@devon/ui` (`src/test-config/`) and
// `@devon/api` (`test/vitest.config.ts`) for the same reason. `package.json`'s `dev`/`build`/`preview`
// scripts point Vite at this file explicitly with `--config`, which works regardless of `root`.
//
// `root` is this file's own directory, computed from `import.meta.url` rather than left as `'.'` --
// verified empirically that Vite resolves a *relative* `root` against `process.cwd()` when invoked
// via `--config <path>` from a different directory (pnpm runs package scripts with cwd = the package
// root, i.e. `apps/web`, not `apps/web/src`), not against the config file's own directory as its docs
// suggest. An absolute path sidesteps the ambiguity entirely.
const srcDir = fileURLToPath(new URL('.', import.meta.url))
// Repo root, three levels up from `apps/web/src` -- same target as the `envDir` returned below, kept
// as its own absolute path here because `loadEnv()` needs it before the config object exists.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export default defineConfig(({ command, mode }) => {
  // `scripts/start.mjs` loads `.env` into `process.env` for every task it spawns (fill-gap: a value
  // already present in the shell wins over the file) before turbo ever starts this process. Vite
  // *also* loads `.env` itself for `import.meta.env`/client code, on its own schedule relative to this
  // callback -- reading `process.env['API_PORT']` directly here raced the two loaders and could see
  // either the shell's value or the file's, inconsistently with what `apps/api`'s `config.ts` (which
  // only ever sees the shell-inherited `process.env`, never touches the file itself) resolved -- the
  // dev proxy then dialled a port nothing was listening on (found running `pnpm start`, 2026-09).
  // Calling `loadEnv()` ourselves, with the same fill-gap precedence as `start.mjs`, makes this
  // callback's view of `.env` deterministic and identical to the API's, regardless of Vite's own
  // internal timing.
  const fileEnv = loadEnv(mode, repoRoot, '')
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  const apiPort = process.env['API_PORT'] ?? '3000'
  const webPort = Number(process.env['WEB_PORT'] ?? 5173)

  return {
    root: srcDir,
    // The real `.env`/`.env.example` live at the repo root (design.md §7.4), three levels up from
    // `apps/web/src`.
    envDir: '../../..',
    // `DEVON_E2E` (design.md §7.4, the `?__state=` forcing flag) is not `VITE_`-prefixed; without this,
    // Vite would strip it from `import.meta.env` for security (client env vars are opt-in by prefix).
    envPrefix: ['VITE_', 'DEVON_'],
    // Self-hosted fonts (H8.2, DESIGN.md §2.3) physically live in `@devon/ui`'s package -- every
    // consumer of `packages/ui/src/styles/fonts.css` (`url('/fonts/...')`) points its own `publicDir`
    // here rather than copying the binary `.woff2` files into `apps/web` (which would also fall
    // outside TOUCHES). Storybook does the same via `staticDirs: ['../public']`.
    publicDir: '../../../packages/ui/public',
    // H4.1: React Compiler on -- in `annotation` mode, not blanket. This is Rolldown-Vite (`vite:
    // 8.2.2`'s own engine, not classic Rollup+Babel -- note the `rolldown-runtime` chunk in every
    // build), so `@vitejs/plugin-react` v6's own `compiler` option (backed by the `oxc-transform-react`
    // optional peer, an Oxc/Rust implementation) is the supported path here, not the classic
    // `babel-plugin-react-compiler` (that still exists as an optional peer for the separate
    // `@rolldown/plugin-babel` bridge, but going through Oxc directly avoids adding a Babel pass to a
    // toolchain that otherwise has none). No `target` option needed: `package.json` pins
    // `react`/`react-dom` at `19.2.8`, which ships the compiler's memoisation runtime
    // (`useMemoCache`) natively.
    //
    // `compilationMode: 'annotation'` (measured, not assumed -- H4.1 itself: "profile before
    // optimising; memoise only measured hot spots"): the plugin's own filter only sends a file
    // through the transform when it contains a literal `'use memo'` directive
    // (`@vitejs/plugin-react/dist/index.js`'s `shouldCompile` check), so compilation is opt-in per
    // component, not applied to the whole `src/` tree. Measured with `tools/perf/bundle/report.mjs`:
    // the default (blanket) `compiler: true` mode compiled every component in the app and cost
    // **+151 kB gzip** of pure memoisation boilerplate (895.6 -> 1047.0 kB total shippable JS, one
    // `pnpm --filter @devon/web build` each way, nothing else changed) for hot spots this codebase
    // already hand-memoises in most of the places that matter -- a straight loss against H4.4's
    // ≤200 kB shell budget and H24.1's LCP budget for a runtime benefit no profile had asked for.
    // `'use memo'` is added below only to the actual measured hot spots this package's own work
    // targets: the virtualised board/table/timeline/archive screens (H4.2) and the personal
    // nested-task tree (many rows, frequent local state updates) -- see each file's own `'use memo'`
    // for its profiling note.
    plugins: [
      react({ compiler: { compilationMode: 'annotation' } }),
      tailwindcss(),
      robotsTxtPlugin(),
    ],
    build: {
      // `agentic/scripts/check-bundle.mjs` reads `apps/web/dist/assets` (design.md §1.1 table) --
      // relative to `root` (`apps/web/src`), that is `../dist`.
      outDir: '../dist',
      emptyOutDir: true,
      sourcemap: command === 'build',
    },
    server: {
      port: webPort,
      // Explicit loopback IPv4 host, not the `localhost` default: on this host Node resolves
      // `localhost` to `::1` first, so Vite's listener is IPv6-only and a client dialling the literal
      // `127.0.0.1` (as `test/e2e/playwright.config.ts`'s `webServer.url` and every same-origin check
      // in this item do) times out even though the server is up. Binding the literal loopback address
      // also matches the "no external call" same-origin requirement below.
      host: '127.0.0.1',
      strictPort: true,
      // Same-origin requirement (I-2, design.md §3.2, this item's handoff: "every shell network
      // request must be same-origin"): the browser only ever calls relative `/api/...` paths: exactly
      // the same in dev (proxied here) and in production (reverse-proxied by Caddy, infra/Caddyfile).
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
        '/healthz': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
        '/readyz': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
    preview: {
      port: webPort,
      host: '127.0.0.1',
    },
  }
})
