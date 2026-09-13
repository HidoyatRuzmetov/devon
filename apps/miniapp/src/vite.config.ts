import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Config under `src/` (not the package root), `root` computed absolutely from `import.meta.url`, and
// `envDir` pointed at the repo root -- all three for exactly the reasons `apps/web/src/vite.config.ts`
// documents at length. Read that file before changing any of them here.
const srcDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, repoRoot, '')
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  const apiPort = process.env['API_PORT'] ?? '3000'
  const port = Number(process.env['MINIAPP_PORT'] ?? 5199)

  return {
    root: srcDir,
    // Served from `/miniapp/` on the same origin as the API in production (infra's reverse proxy
    // maps that path to `apps/miniapp/dist`), so every asset URL the build emits has to carry that
    // prefix. The Mini App MUST be same-origin with the API: its session is the ordinary `devon_sid`
    // cookie, and a cookie set by a different origin would never be sent back.
    base: '/miniapp/',
    envDir: '../../..',
    envPrefix: ['VITE_', 'DEVON_'],
    // Self-hosted fonts live in `@devon/ui`'s package; point `publicDir` at them rather than copying
    // the `.woff2` binaries into this app (identical to `apps/web`).
    publicDir: '../../../packages/ui/public',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      sourcemap: false,
    },
    server: {
      port,
      // Literal loopback IPv4, not `localhost`: on Windows Node resolves `localhost` to `::1` first,
      // which makes Vite's listener IPv6-only and unreachable from a client dialling `127.0.0.1`.
      host: '127.0.0.1',
      strictPort: true,
      // Same-origin in development too: the browser only ever calls relative `/api/...`, proxied here
      // and reverse-proxied in production, so the session cookie is first-party in both.
      proxy: {
        '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
    preview: { port, host: '127.0.0.1' },
  }
})
