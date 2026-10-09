import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

// A developer's shell or .env may use NODE_ENV=development. A shippable build
// must explicitly select React's production runtime before Vite loads that file.
const built = spawnSync(
  process.execPath,
  [vite, 'build', '--config', 'src/vite.config.ts', ...process.argv.slice(2)],
  { cwd: webRoot, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' },
)
if (built.error) throw built.error
process.exitCode = built.status ?? 1
