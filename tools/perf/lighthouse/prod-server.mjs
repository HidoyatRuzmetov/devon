#!/usr/bin/env node
// Measurement-only static+proxy server (H24.1 baseline): the production JS bundle already exists at
// apps/web/dist (`pnpm --filter @devon/web build`), but `apps/web/src/vite.config.ts`'s `preview`
// block has no `/api` proxy (only `server` does, for dev) -- so Lighthouse against `vite preview`
// alone would 404 every API call. Rather than edit vite.config.ts (product code, out of scope for a
// measurement task), this tiny same-origin static file server + reverse proxy stands in for the
// `caddy` Compose profile's job (infra/Caddyfile expects `web`/`api` container service names that do
// not exist yet -- EPIC not shipped) so Lighthouse sees the real minified bundle instead of Vite's
// unbundled dev-mode module graph. No product code touched; this file lives entirely under tools/perf/.
import http from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const DIST = join(repoRoot, 'apps', 'web', 'dist')
const API_TARGET = process.env.DEVON_PERF_API_TARGET || 'http://127.0.0.1:3000'
const PORT = Number(process.env.PORT || 4174)

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`[prod-server] ${DIST}/index.html not found -- run: pnpm --filter @devon/web build`)
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest'])

function proxyToApi(req, res) {
  const target = new URL(req.url, API_TARGET)
  const proxyReq = http.request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', (e) => {
    res.statusCode = 502
    res.end('Bad gateway: ' + e.message)
  })
  req.pipe(proxyReq)
}

function serveStatic(req, res, pathname) {
  let filePath = join(DIST, decodeURIComponent(pathname))
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(DIST, 'index.html')
  const ext = extname(filePath)
  const contentType = MIME[ext] || 'application/octet-stream'
  const immutable = /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(filePath) // Vite fingerprints chunks this way
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')

  const acceptEncoding = req.headers['accept-encoding'] || ''
  if (COMPRESSIBLE.has(ext) && acceptEncoding.includes('gzip')) {
    const body = gzipSync(readFileSync(filePath))
    res.setHeader('Content-Encoding', 'gzip')
    res.end(body)
  } else {
    createReadStream(filePath).pipe(res)
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/readyz') {
    proxyToApi(req, res)
  } else {
    serveStatic(req, res, url.pathname)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[prod-server] serving ${DIST} on http://127.0.0.1:${PORT} (proxying /api,/healthz,/readyz -> ${API_TARGET})`)
})
