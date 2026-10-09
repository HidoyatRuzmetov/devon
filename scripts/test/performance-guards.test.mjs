import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  assertPerformancePortAvailable,
  assertPerformanceDatabaseEnvironment,
  performanceEnvironment,
} from '../../tools/perf/local-config.mjs'
import { completedScenario, k6Target, summarizeK6Receipt } from '../../tools/perf/k6/receipts.mjs'
import { runChecks } from '../../tools/perf/check.mjs'
import { findPerformanceChromium } from '../../tools/perf/lighthouse/browser-path.mjs'
import { assessBuiltRoute } from '../../tools/perf/lighthouse/budgets.mjs'
import { inspectProductionRuntime, productionBuildInputs } from '../../tools/perf/web-build.mjs'

test('performance forces one owned namespace and excludes inherited integrations and cloud settings', () => {
  const exampleCredential = 'Example-only credential'
  const env = performanceEnvironment({
    FLOW_DB_NAME: 'devon',
    API_PORT: '3000',
    WEB_PORT: '5173',
    FLOW_API_PORT: '48971',
    FLOW_WEB_PORT: '48972',
    AI_API_KEY: exampleCredential,
    SMTP_PASSWORD: exampleCredential,
    TELEGRAM_BOT_TOKEN: exampleCredential,
    VAPID_PRIVATE_KEY: exampleCredential,
    DEVON_SENTINEL_URL: 'https://example.invalid',
    NODE_OPTIONS: '--require=foreign-client',
    K6_CLOUD_TOKEN: exampleCredential,
    DEVON_PERF_PASSWORD: exampleCredential,
    DB_POOL_MAX: '200',
    FLOW_PRODUCTION_BUILD: '0',
    DEVON_E2E: '1',
  })
  assert.equal(env.FLOW_DB_NAME, 'devon_qa_perf_gate')
  assert.equal(env.FLOW_API_PORT, '48971')
  assert.equal(env.FLOW_WEB_PORT, '48972')
  assert.equal(env.AI_API_KEY, '')
  for (const key of [
    'SMTP_PASSWORD',
    'TELEGRAM_BOT_TOKEN',
    'VAPID_PRIVATE_KEY',
    'DEVON_SENTINEL_URL',
    'NODE_OPTIONS',
    'K6_CLOUD_TOKEN',
    'DEVON_PERF_PASSWORD',
  ])
    assert.equal(env[key], undefined)
  assert.equal(env.DB_POOL_MAX, '6')
  assert.equal(env.K6_NO_USAGE_REPORT, 'true')
  assert.equal(env.DEVON_PERF_LOCAL_FIXTURES, '1')
  assert.equal(env.FLOW_DB_PORT, '55471')
  assert.equal(env.FLOW_PRODUCTION_BUILD, '1')
  assert.equal(env.DEVON_E2E, '0')
  assert.match(env.FLOW_DB_CONTAINER, /^flow-devon_qa_perf_gate-[a-f0-9]{12}-postgres$/)
  assertPerformanceDatabaseEnvironment(env)
})

test('release CI explicitly selects production performance without altering ordinary browser selection', () => {
  const root = new URL('../../', import.meta.url)
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8').replaceAll(
    '\r\n',
    '\n',
  )
  const jobs = [
    ...workflow.matchAll(
      /^      - name: Verify compiled production browser journeys\n([\s\S]*?)^      - name: Run the (integration|release) gate profile\n([\s\S]*?)(?=^      - name:)/gm,
    ),
  ]
  assert.deepEqual(jobs.map((job) => job[2]).sort(), ['integration', 'release'])
  for (const [, compiled, profile, ordinary] of jobs) {
    assert.match(compiled, /^\s+FLOW_PRODUCTION_BUILD: '1'$/m)
    assert.match(compiled, /^\s+DEVON_E2E: '0'$/m)
    const build = compiled.indexOf('await buildPerformanceWeb(process.cwd(), process.env)')
    const app = compiled.indexOf('--grep-invert @a11y')
    const a11y = compiled.indexOf('--grep @a11y')
    assert.ok(build >= 0 && app > build && a11y > app, 'fresh receipt precedes both browser gates')
    assert.equal(
      compiled.match(
        /pnpm --filter @devon\/web exec playwright test --config test\/e2e\/playwright\.config\.ts/g,
      )?.length,
      2,
    )
    assert.equal(compiled.match(/--workers=1 --retries=0/g)?.length, 2)
    assert.match(ordinary, new RegExp(`run: node agentic/scripts/gate\\.mjs --profile ${profile}`))
    assert.ok(!ordinary.includes('FLOW_PRODUCTION_BUILD'), 'the ordinary gate retains dev fixtures')
  }
  // Execute the actual configuration and receipt verifier in an owned fixture. Neither browser
  // nor API services start; the copied source has the same relative layout and dependency lookup.
  const scratch = resolve(fileURLToPath(new URL('apps/web/test/e2e/.tmp/', root)))
  mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(join(scratch, 'flow-config-'))
  try {
    for (const source of [
      'apps/web/test/e2e/playwright.config.ts',
      'apps/web/test/e2e/platform-qa.config.ts',
      'apps/web/test/e2e/flow-env.ts',
      'apps/web/test/e2e/flow-safety.ts',
      'apps/web/test/e2e/flow-production.ts',
      'tools/perf/web-build.mjs',
      'tools/security/source-stage.mjs',
    ]) {
      const target = join(fixture, source)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(new URL(source, root), target)
    }
    writeFileSync(join(fixture, 'package.json'), '{"type":"module"}')
    const input = join(fixture, 'apps/web/src/entry.ts')
    mkdirSync(dirname(input), { recursive: true })
    writeFileSync(input, 'export const fixture = 1')
    assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: fixture }).status, 0)
    const env = {
      ...process.env,
      NODE_OPTIONS: '',
      FLOW_DB_NAME: 'devon_flow_e2e_config_guard',
      FLOW_DB_HOST: '127.0.0.1',
      FLOW_DB_PORT: '55432',
      FLOW_DB_CONTAINER: 'devon-postgres',
      FLOW_API_PORT: '48921',
      FLOW_WEB_PORT: '48922',
      DEVON_E2E: '1',
    }
    delete env.FLOW_PRODUCTION_BUILD
    function load(flag, configName = 'playwright.config.ts') {
      return spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `const config = (await import(${JSON.stringify(pathToFileURL(join(fixture, 'apps/web/test/e2e', configName)).href)})).default; process.stdout.write(JSON.stringify({ command: config.webServer.command, forcedState: config.webServer.env.DEVON_E2E, reuseExistingServer: config.webServer.reuseExistingServer, testMatch: config.testMatch, testIgnore: config.testIgnore }));`,
        ],
        {
          cwd: fileURLToPath(new URL('apps/api/', root)),
          env: flag === undefined ? env : { ...env, FLOW_PRODUCTION_BUILD: flag },
          encoding: 'utf8',
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
      )
    }
    for (const flag of [undefined, '0', 'true']) {
      const ordinary = load(flag)
      assert.equal(ordinary.status, 0, ordinary.stderr || ordinary.error?.message)
      const config = JSON.parse(ordinary.stdout)
      assert.equal(config.command, 'pnpm --filter @devon/web dev --mode test')
      assert.equal(config.forcedState, '1')
      assert.equal(config.reuseExistingServer, false)
      assert.deepEqual(config.testMatch, ['**/*.flow.spec.ts', '**/*.smoke.spec.ts'])
      assert.deepEqual(config.testIgnore, [])
    }
    const qaOrdinary = load(undefined, 'platform-qa.config.ts')
    assert.equal(qaOrdinary.status, 0, qaOrdinary.stderr || qaOrdinary.error?.message)
    assert.equal(JSON.parse(qaOrdinary.stdout).forcedState, '1')
    assert.equal(JSON.parse(qaOrdinary.stdout).command, 'pnpm --filter @devon/web dev --mode test')
    const missing = load('1')
    assert.notEqual(missing.status, 0, 'explicit production requires a build receipt')
    assert.match(missing.stderr, /production-build\.json/)
    const hash = productionBuildInputs(fixture).sha256
    const receipt = join(fixture, 'tools/perf/lighthouse/out/production-build.json')
    mkdirSync(dirname(receipt), { recursive: true })
    writeFileSync(
      receipt,
      JSON.stringify({
        stable: true,
        inputsBefore: hash,
        inputsAfter: hash,
        forcedStateBuildFlag: false,
      }),
    )
    const built = load('1')
    assert.equal(built.status, 0, built.stderr || built.error?.message)
    const config = JSON.parse(built.stdout)
    assert.equal(config.command, 'pnpm --filter @devon/web preview --mode test')
    assert.equal(config.forcedState, '0')
    assert.equal(config.reuseExistingServer, false)
    assert.deepEqual(config.testMatch, ['**/*.flow.spec.ts', '**/*.smoke.spec.ts'])
    assert.deepEqual(config.testIgnore, [
      '**/avatar-readability.flow.spec.ts',
      '**/badge-contrast.flow.spec.ts',
      '**/dialog-scroll.flow.spec.ts',
    ])
    const qaBuilt = load('1', 'platform-qa.config.ts')
    assert.equal(qaBuilt.status, 0, qaBuilt.stderr || qaBuilt.error?.message)
    assert.equal(JSON.parse(qaBuilt.stdout).forcedState, '0')
    assert.equal(JSON.parse(qaBuilt.stdout).command, 'pnpm --filter @devon/web preview --mode test')
    writeFileSync(input, 'export const fixture = 2')
    const stale = load('1')
    assert.notEqual(stale.status, 0)
    assert.match(stale.stderr, /stable current production input receipt/)
  } finally {
    assert.equal(dirname(fixture), scratch)
    rmSync(fixture, { recursive: true, force: true })
  }
  const untouched = { FLOW_PRODUCTION_BUILD: '0', DEVON_E2E: '1' }
  performanceEnvironment(untouched)
  assert.deepEqual(untouched, { FLOW_PRODUCTION_BUILD: '0', DEVON_E2E: '1' })
})

test('database orchestration refuses any foreign namespace, host, port, name or run receipt', () => {
  const env = performanceEnvironment({}, 'abcdef012345')
  for (const override of [
    { FLOW_DB_NAME: 'devon' },
    { FLOW_DB_HOST: 'example.invalid' },
    { FLOW_DB_HOST: 'localhost' },
    { FLOW_DB_PORT: '55432' },
    { FLOW_DB_CONTAINER: 'devon-postgres' },
    { DEVON_PERF_RUN: 'another-run' },
    { DEVON_PERF_LOCAL_FIXTURES: undefined },
  ])
    assert.throws(() => assertPerformanceDatabaseEnvironment({ ...env, ...override }), /unowned/)
  assert.throws(() => performanceEnvironment({}, '../foreign'))
})

test('performance refuses remote database hosts, invalid ports and shared API/web ports', () => {
  assert.throws(() => performanceEnvironment({ FLOW_DB_HOST: 'example.invalid' }))
  assert.throws(() => performanceEnvironment({ FLOW_API_PORT: '3000', FLOW_WEB_PORT: '3000' }))
  assert.throws(() => performanceEnvironment({ FLOW_API_PORT: '80' }))
  assert.throws(() => performanceEnvironment({ FLOW_DB_CONTAINER: '../foreign' }))
})

test('performance refuses an existing loopback listener instead of attaching', async () => {
  const listener = createServer()
  await new Promise((done) => listener.listen(0, '127.0.0.1', done))
  try {
    await assert.rejects(
      assertPerformancePortAvailable(listener.address().port),
      /occupied loopback port/,
    )
  } finally {
    await new Promise((done) => listener.close(done))
  }
})

test('native and Linux host-network k6 use loopback; only Windows Docker uses its host gateway', () => {
  assert.equal(k6Target('win32', 48971, true), 'http://127.0.0.1:48971')
  assert.equal(k6Target('linux', 48971, false), 'http://127.0.0.1:48971')
  assert.equal(k6Target('win32', 48971, false), 'http://host.docker.internal:48971')
  assert.throws(() => k6Target('linux', '48971/path', false))
})

test('a setup request or all failed endpoint checks cannot count as completed performance', () => {
  const json = {
    metrics: {
      http_reqs: { count: 26 },
      iterations: { count: 24 },
      checks: { passes: 0, fails: 24 },
    },
  }
  assert.equal(completedScenario(summarizeK6Receipt(json)), false)
  assert.equal(
    completedScenario(summarizeK6Receipt({ metrics: { http_reqs: { count: 1 } } })),
    false,
  )
  assert.throws(() => summarizeK6Receipt({}))
  assert.equal(
    completedScenario(
      summarizeK6Receipt({
        metrics: {
          http_reqs: { count: 26 },
          iterations: { count: 24 },
          checks: { passes: 24, fails: 0 },
          http_req_failed: { value: 0 },
        },
      }),
    ),
    true,
  )
})

test('direct performance checks cannot run without the owned orchestration marker', async () => {
  await assert.rejects(runChecks(48971, 48972), /owned guarded runner/)
})

test('the current production assets are checked while stale source maps cannot satisfy the receipt', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'devon-perf-runtime-'))
  const assets = join(scratch, 'assets')
  const maps = join(scratch, 'maps')
  mkdirSync(assets)
  mkdirSync(maps)
  try {
    writeFileSync(join(assets, 'entry.js'), 'fixture only')
    writeFileSync(
      join(maps, 'old.js.map'),
      JSON.stringify({ sources: ['react-dom/cjs/react-dom-client.production.js'] }),
    )
    assert.throws(() => inspectProductionRuntime(assets, maps), /no source map/)
    writeFileSync(
      join(maps, 'entry.js.map'),
      JSON.stringify({ sources: ['react-dom/cjs/react-dom-client.development.js'] }),
    )
    assert.throws(() => inspectProductionRuntime(assets, maps), /genuine production/)
    writeFileSync(
      join(maps, 'entry.js.map'),
      JSON.stringify({ sources: ['react-dom/cjs/react-dom-client.production.js'] }),
    )
    assert.equal(inspectProductionRuntime(assets, maps).length, 1)
    writeFileSync(
      join(maps, 'old.js.map'),
      JSON.stringify({ sources: ['react-dom/cjs/react-dom-client.development.js'] }),
    )
    assert.equal(inspectProductionRuntime(assets, maps).length, 1)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('built route budgets refuse slow, shifting, low-scoring or incomplete measurements', () => {
  const report = (lcp, cls, score) => ({
    audits: {
      'largest-contentful-paint': { numericValue: lcp },
      'cumulative-layout-shift': { numericValue: cls },
    },
    categories: { performance: { score } },
  })
  assert.equal(assessBuiltRoute(report(2499, 0.099, 0.9)).pass, true)
  for (const invalid of [
    report(2500, 0, 1),
    report(2000, 0.1, 1),
    report(2000, 0, 0.89),
    report(NaN, 0, 1),
    {},
    { ...report(1000, 0, 1), runtimeError: { code: 'FAILED' } },
  ])
    assert.equal(assessBuiltRoute(invalid).pass, false)
})

test('explicit Linux and Windows browser caches resolve real files and reject missing executables', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'devon-perf-browser-'))
  try {
    assert.throws(() => findPerformanceChromium(join(scratch, 'absent')), /does not exist/)
    assert.throws(() => findPerformanceChromium(scratch), /missing/)
    for (const [platform, folder, name] of [
      ['linux', 'chrome-linux64', 'chrome'],
      ['win32', 'chrome-win64', 'chrome.exe'],
    ]) {
      const directory = join(scratch, 'chromium-1234', folder)
      mkdirSync(directory, { recursive: true })
      const executable = join(directory, name)
      writeFileSync(executable, 'fixture only; never executed')
      assert.equal(findPerformanceChromium(scratch, platform), executable)
    }
    mkdirSync(join(scratch, 'chromium-9999'), { recursive: true })
    assert.match(findPerformanceChromium(scratch, 'linux'), /chromium-1234/)
  } finally {
    // mkdtemp gives this test sole ownership of this literal absolute scratch path.
    rmSync(scratch, { recursive: true })
  }
})
