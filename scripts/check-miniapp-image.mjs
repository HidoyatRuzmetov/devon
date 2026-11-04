// Exercise the actual production image: a successful web homepage must not hide a missing Mini App.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const image = process.argv[2]
if (!image) throw new Error('usage: node scripts/check-miniapp-image.mjs <web-image>')
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
const name = `devon-miniapp-check-${process.pid}`
try {
  docker('run', '--rm', '-d', '--name', name, '-p', '127.0.0.1::8080', image)
  const origin = `http://${docker('port', name, '8080/tcp')}`
  let response
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      response = await fetch(`${origin}/miniapp/`, { signal: AbortSignal.timeout(2000) })
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  assert.equal(response?.status, 200, 'Mini App shell must be served')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const html = await response.text()
  assert.match(html, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/)
  const assets = [...html.matchAll(/(?:src|href)="(\/miniapp\/assets\/[^"<>]+)"/g)].map(
    (match) => match[1],
  )
  assert.ok(
    assets.some((path) => path.endsWith('.js')),
    'Mini App JavaScript is missing',
  )
  assert.ok(
    assets.some((path) => path.endsWith('.css')),
    'Mini App stylesheet is missing',
  )
  for (const path of assets) {
    const asset = await fetch(origin + path)
    assert.equal(asset.status, 200, path)
    assert.match(asset.headers.get('content-type'), /javascript|text\/css/)
    assert.match(asset.headers.get('cache-control'), /immutable/)
  }
  assert.equal((await fetch(`${origin}/miniapp/assets/missing.js`)).status, 404)
  assert.equal((await fetch(`${origin}/miniapp/assets/missing.js.map`)).status, 404)
  assert.equal((await fetch(`${origin}/miniapp`, { redirect: 'manual' })).status, 308)
  const web = await (await fetch(origin)).text()
  assert.doesNotMatch(web, /telegram-web-app\.js|\/miniapp\/assets\//)
  console.log('Production image serves separate web/Mini App shells, bundles and safe cache rules.')
} finally {
  try {
    docker('rm', '-f', name)
  } catch {
    // A failed image launch can leave no container to remove.
  }
}
