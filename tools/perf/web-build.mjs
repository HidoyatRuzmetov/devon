import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { stageRepositorySource } from '../security/source-stage.mjs'

export function productionBuildInputs(root) {
  const source = stageRepositorySource(root)
  try {
    const manifest = source.manifest.filter(
      ({ path }) =>
        /^(apps\/web\/(src|scripts|public)\/|packages\/(ui|i18n|contracts)\/(src|messages|public)\/|packages\/config\/)/.test(
          path,
        ) ||
        /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|apps\/web\/index\.html)$/.test(
          path,
        ) ||
        /^(?:apps\/web|packages\/(ui|i18n|contracts))\/package\.json$/.test(path),
    )
    return { sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), manifest }
  } finally {
    source.cleanup()
  }
}

export function inspectProductionRuntime(assets, maps) {
  const sources = readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .flatMap((file) => {
      const map = resolve(maps, file + '.map')
      if (!existsSync(map)) {
        if (/^rolldown-runtime-[A-Za-z0-9_-]+\.js$/.test(file)) return []
        throw new Error('Current production asset has no source map: ' + file)
      }
      return JSON.parse(readFileSync(map, 'utf8')).sources.map((source) => ({
        asset: file,
        source,
      }))
    })
  const reactSources = sources.filter(({ source }) => /react[^/]*\/cjs\//.test(source))
  if (
    !reactSources.some(({ source }) => source.endsWith('/react-dom-client.production.js')) ||
    reactSources.some(({ source }) => source.endsWith('.development.js'))
  )
    throw new Error('Performance assets must contain the genuine production React runtime')
  return reactSources
}

export async function buildPerformanceWeb(root, env) {
  const output = resolve(root, 'tools/perf/lighthouse/out')
  mkdirSync(output, { recursive: true })
  const log = resolve(output, 'production-build.log')
  writeFileSync(log, '')
  const startedAt = new Date().toISOString()
  const before = productionBuildInputs(root)
  writeFileSync(
    resolve(output, 'production-build-inputs-before.json'),
    JSON.stringify(before, null, 2),
  )
  for (const script of ['build.mjs', 'move-sourcemaps.mjs']) {
    await new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve(root, 'apps/web/scripts', script)], {
        cwd: root,
        env: { ...env, NODE_ENV: 'production', DEVON_E2E: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.on('data', (data) => appendFileSync(log, data))
      child.stderr.on('data', (data) => appendFileSync(log, data))
      child.once('error', reject)
      child.once('close', (code) =>
        code === 0
          ? done()
          : reject(new Error('Production web build failed; see production-build.log')),
      )
    })
  }
  const runtime = inspectProductionRuntime(
    resolve(root, 'apps/web/dist/assets'),
    resolve(root, 'apps/web/dist-sourcemaps'),
  )
  const after = productionBuildInputs(root)
  writeFileSync(
    resolve(output, 'production-build-inputs-after.json'),
    JSON.stringify(after, null, 2),
  )
  const receipt = {
    startedAt,
    finishedAt: new Date().toISOString(),
    inputsBefore: before.sha256,
    inputsAfter: after.sha256,
    stable: before.sha256 === after.sha256,
    reactRuntime: runtime,
    forcedStateBuildFlag: false,
  }
  writeFileSync(resolve(output, 'production-build.json'), JSON.stringify(receipt, null, 2))
  if (!receipt.stable)
    throw new Error(
      'Web source changed during the owned performance build; rerun after source settles',
    )
  console.log('[perf:check] fresh production React assets verified: ' + before.sha256)
  return receipt
}
