import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  partitionGateProfile,
  requireSuccessfulDependencies,
  REQUIRED_CI_JOBS,
} from '../ci-gate.mjs'

const root = new URL('../../', import.meta.url)
const configuration = JSON.parse(readFileSync(new URL('agentic/gates.json', root), 'utf8'))
const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8').replaceAll(
  '\r\n',
  '\n',
)

for (const profile of ['integration', 'release']) {
  test(`${profile}: partitions retain every configured gate exactly once and in relative order`, () => {
    const parts = partitionGateProfile(configuration, profile)
    assert.deepEqual(parts.browser, ['e2e', 'a11y'])
    assert.deepEqual(
      [...parts.source, ...parts.browser].sort(),
      [...configuration.profiles[profile]].sort(),
    )
    assert.equal(
      new Set([...parts.source, ...parts.browser]).size,
      configuration.profiles[profile].length,
    )
    for (const part of Object.values(parts)) {
      assert.deepEqual(
        part,
        configuration.profiles[profile].filter((name) => part.includes(name)),
      )
    }
    assert.ok(parts.source.includes('build') && parts.source.includes('migrate'))
    assert.ok(parts.source.includes('security') && parts.source.includes('unit'))
    assert.equal(parts.source.includes('perf'), profile === 'release')
    assert.equal(parts.source.includes('deps'), profile === 'release')
  })
}

test('a newly introduced gate is included automatically, while an invalid profile fails closed', () => {
  const future = structuredClone(configuration)
  future.profiles.integration.push('future-safety-check')
  future.gates['future-safety-check'] = { cmd: 'example', blocking: true }
  assert.ok(partitionGateProfile(future, 'integration').source.includes('future-safety-check'))
  for (const profile of ['fast', 'item', 'unknown', undefined]) {
    assert.throws(() => partitionGateProfile(configuration, profile), /Invalid/)
  }
  for (const broken of [[], ['e2e'], ['e2e', 'a11y', 'e2e'], ['e2e', 'a11y', 'unknown']]) {
    const bad = structuredClone(configuration)
    bad.profiles.integration = broken
    assert.throws(() => partitionGateProfile(bad, 'integration'), /Invalid/)
  }
})

const successful = () =>
  Object.fromEntries(REQUIRED_CI_JOBS.map((name) => [name, { result: 'success' }]))

test('the final required check accepts only the entire successful dependency set', () => {
  assert.doesNotThrow(() => requireSuccessfulDependencies(successful()))
  for (const name of REQUIRED_CI_JOBS) {
    for (const result of ['failure', 'cancelled', 'skipped', 'pending', undefined]) {
      const dependencies = successful()
      dependencies[name] = { result }
      assert.throws(() => requireSuccessfulDependencies(dependencies), new RegExp(name))
    }
    const missing = successful()
    delete missing[name]
    assert.throws(() => requireSuccessfulDependencies(missing), /complete CI/)
  }
  for (const invalid of [null, [], {}, { ...successful(), unexpected: { result: 'success' } }]) {
    assert.throws(() => requireSuccessfulDependencies(invalid), /complete CI/)
  }
})

test('the real final-check command fails when a required job was skipped', () => {
  const dependencies = successful()
  dependencies['browser-production'].result = 'skipped'
  for (const [needs, expected] of [
    [successful(), 0],
    [dependencies, 1],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../ci-gate.mjs', import.meta.url)), 'verify'],
      {
        encoding: 'utf8',
        env: { ...process.env, NEEDS_JSON: JSON.stringify(needs) },
      },
    )
    assert.equal(result.status, expected, result.stdout + result.stderr)
  }
})

test('both stable required checks await all independent jobs, even on upstream failures', () => {
  for (const job of ['gate', 'release-gate']) {
    const section = workflow.match(
      new RegExp(`^  ${job}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'),
    )?.[1]
    assert.ok(section, `missing ${job}`)
    assert.match(section, /if:.*always\(\)/)
    assert.match(
      section,
      /needs: \[source-gates, browser-development, browser-production, workflow-regressions\]/,
    )
    assert.match(section, /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/)
    assert.match(section, /run: node scripts\/ci-gate\.mjs verify/)
  }
  assert.match(workflow, /name: gate \(integration profile\)/)
  assert.match(workflow, /name: gate \(release profile\)/)
  assert.doesNotMatch(workflow, /continue-on-error|--pass-with-no-tests/)
  for (const name of REQUIRED_CI_JOBS) {
    const section = workflow.match(
      new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:)`, 'm'),
    )?.[1]
    assert.ok(section, `missing ${name}`)
    assert.doesNotMatch(
      section,
      /^    needs:|^    if:/m,
      'independent checks always run in isolated jobs',
    )
    assert.match(section, /uses: \.\/.github\/actions\/ci-setup/)
    assert.match(section, /docker compose.*up -d --wait postgres valkey/)
  }
})

test('production scanning, immutable image tags and exact-main CI deployment gates remain required', () => {
  const deployment = readFileSync(new URL('.github/workflows/deploy-production.yml', root), 'utf8')
  assert.match(deployment, /github\.event\.workflow_run\.conclusion == 'success'/)
  assert.match(deployment, /workflows: \[CI\]/)
  assert.match(deployment, /Refusing a stale or non-main deployment/)
  assert.match(deployment, /ci\.yml\/runs\?head_sha=\$RELEASE_SHA&event=push&status=success/)
  assert.match(
    deployment,
    /--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1/,
  )
  assert.match(deployment, /Deploy with backup, migration, readiness gate, and image rollback/)
})

test('compiled avatar interactions are mandatory alongside all existing workflow regressions', () => {
  const section = workflow.match(/^  workflow-regressions:\n([\s\S]*?)(?=^  [\w-]+:)/m)?.[1]
  assert.ok(section, 'the dedicated regression job must remain required by the aggregate')
  const step = section.match(
    /^      - name: Verify everyday workflow and real upload-scanning regressions\n([\s\S]*?)(?=^      - name:)/m,
  )?.[1]
  assert.ok(step, 'the real workflow regression step must exist')
  assert.match(step, /^\s+FLOW_PRODUCTION_BUILD: '1'$/m)
  assert.match(step, /^\s+DEVON_E2E: '0'$/m)
  const required = [
    'work-worker-qa.config.ts',
    'structure-author-qa.config.ts',
    'board-navigation-qa.config.ts',
    'platform-qa.config.ts platform-invite-password.qa.spec.ts',
    'platform-qa.config.ts platform-department-decision.qa.spec.ts',
    'scanner-qa.config.ts',
    'avatar-interactions-qa.config.ts',
  ]
  const commands = step
    .split('\n')
    .filter((line) => line.includes('pnpm --filter @devon/web exec playwright test'))
  assert.equal(commands.length, required.length)
  required.forEach((config, index) => {
    assert.ok(commands[index].includes(`--config test/e2e/${config} --project chromium`))
  })
  assert.equal(
    commands.at(-1).trim(),
    'FLOW_DB_NAME=devon_flow_e2e_avatar FLOW_API_PORT=48941 FLOW_WEB_PORT=48942 FLOW_CENTRIFUGO_PORT=48943 FLOW_REALTIME=1 FLOW_SEED_DEMO=0 FLOW_CLAMAV=0 pnpm --filter @devon/web exec playwright test --config test/e2e/avatar-interactions-qa.config.ts --project chromium',
  )
  assert.ok(
    step.indexOf('docker pull centrifugo/centrifugo:') < step.indexOf('devon_flow_e2e_avatar'),
  )
  assert.ok(section.includes('artifacts/qa/2026-10/avatar-interactions/**'))
  const avatarConfig = readFileSync(
    new URL('apps/web/test/e2e/avatar-interactions-qa.config.ts', root),
    'utf8',
  )
  assert.match(avatarConfig, /workers: 1/)
  assert.match(avatarConfig, /retries: 0/)
  assert.ok(avatarConfig.includes("testMatch: 'avatar-interactions.qa.spec.ts'"))
})
