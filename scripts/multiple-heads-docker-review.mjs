// Local-only Docker review. Uses no ambient application credentials or existing database.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = resolve(root, 'apps/web/test/e2e/.tmp/devon_qa_heads_docker')
const envFile = resolve(scratch, 'compose.env')
const adminFile = resolve(scratch, 'superadmin.json')
const action = process.argv[2] ?? 'up'
if (!['up', 'status', 'stop'].includes(action)) throw new Error('Use up, status or stop')
const endpoint = spawnSync(
  'docker',
  ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
  { encoding: 'utf8' },
)
for (const value of [endpoint.stdout?.trim(), process.env.DOCKER_HOST].filter(Boolean)) {
  if (!/^(?:npipe:\/{2,4}\.\/pipe\/|unix:\/\/\/)/.test(value))
    throw new Error('Review refuses a remote Docker endpoint')
}
if (endpoint.status !== 0) throw new Error('Local Docker is unavailable')
mkdirSync(scratch, { recursive: true })
if (!existsSync(envFile)) {
  const keys = ['DB_ROOT', 'DB_APP', 'DB_MIGRATOR', 'CSRF', 'REALTIME_API', 'REALTIME_TOKEN']
  writeFileSync(
    envFile,
    keys.map((key) => `REVIEW_${key}=${randomBytes(32).toString('hex')}`).join('\n') + '\n',
    { mode: 0o600 },
  )
}
function compose(args, capture = false) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      'devon-heads-review',
      '--env-file',
      envFile,
      '-f',
      resolve(root, 'infra/docker-compose.review.yml'),
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 240_000,
      ...(capture ? {} : { stdio: 'inherit' }),
    },
  )
  if (result.status !== 0)
    throw new Error(`Review Docker ${args[0]} failed${capture ? `: ${result.stderr}` : ''}`)
  return result.stdout
}
if (action === 'stop') compose(['stop'])
else if (action === 'status') compose(['ps'])
else {
  compose(['up', '-d', '--wait', 'postgres', 'valkey', 'centrifugo'])
  compose(['run', '--rm', 'migrate'])
  compose(['up', '-d', '--wait', 'api', 'web', 'gateway'])
  if (!existsSync(adminFile)) {
    const logs = compose(['logs', '--no-color', 'api'], true)
    const token = /\/setup\?token=([^&\s"]+)/.exec(logs)?.[1]
    if (!token) throw new Error('Review API has no setup token; refusing to guess an account')
    const admin = {
      login: 'flow.superadmin',
      password: `ReviewExample-${randomBytes(24).toString('base64url')}Aa1`,
    }
    const response = await fetch(
      // Review credentials stay on this fixed loopback endpoint; redirects are forbidden below.
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      `http://127.0.0.1:48931/api/v1/setup/${decodeURIComponent(token)}`,
      {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...admin, givenName: 'Review', familyName: 'Administrator' }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (response.status !== 201) throw new Error(`Review setup failed: ${response.status}`)
    writeFileSync(adminFile, JSON.stringify(admin), { mode: 0o600 })
  }
  // Local Docker readiness only: this fixed loopback URL cannot follow redirects off-machine.
  // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
  const response = await fetch('http://127.0.0.1:48932/readyz', {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Review readiness failed: ${response.status}`)
  // Record no credentials in review evidence.
  const images = ['api', 'web'].map((service) => {
    const result = spawnSync(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', `devon-${service}:multiple-heads-review`],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) throw new Error('Cannot inspect the review image')
    return { service, image: result.stdout.trim() }
  })
  writeFileSync(
    resolve(scratch, 'docker-receipt.json'),
    JSON.stringify(
      {
        url: 'http://127.0.0.1:48932',
        project: 'devon-heads-review',
        images,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  console.log('Docker review ready: http://127.0.0.1:48932')
}
