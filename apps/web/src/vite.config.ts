import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

export default defineConfig(({ command }) => {
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
    plugins: [react(), tailwindcss()],
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
