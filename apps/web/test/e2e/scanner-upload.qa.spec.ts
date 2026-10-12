import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, test, type Browser, type BrowserContext } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_DB_CONTAINER, FLOW_DB_NAME, FLOW_TMP_DIR } from './flow-env.js'
import { FLOW_SCANNER_FILE, waitForFlowScanner, type FlowScannerState } from './flow-scanner.js'
import { assertLocalDockerEndpoint, controlOwnedContainer } from './flow-services.js'

const evidence = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/scanner')
type Metadata = {
  id: string
  key: string
  upload_key: string
  scan_status: string
  deleted_at: string | null
  status: string
}

function metadata(card: string): Metadata[] {
  if (!/^devon_(?:flow_e2e|qa)(?:_[a-z0-9]+)*$/.test(FLOW_DB_NAME) || !/^[a-f0-9-]{36}$/.test(card))
    throw new Error('Scanner proof refuses a foreign database/card')
  const local = spawnSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  )
  if (local.status !== 0) throw new Error('Cannot verify local Docker context')
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
  assertLocalDockerEndpoint(local.stdout.trim())
  const result = spawnSync(
    'docker',
    [
      'exec',
      FLOW_DB_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      FLOW_DB_NAME,
      '-At',
      '-c',
      `select coalesce(json_agg(x), '[]'::json) from (select a.id,a.key,a.scan_status,a.deleted_at,u.key as upload_key,u.status from app.attachments a join app.uploads u on u.id=a.id where a.subject_id='${card}' order by a.created_at) x`,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error('Owned scanner metadata read failed')
  return JSON.parse(result.stdout.trim()) as Metadata[]
}
function stored(key: string): string {
  const storage = resolve(FLOW_TMP_DIR, 'storage')
  const path = resolve(storage, key)
  const within = relative(storage, path)
  if (
    !within.startsWith(`attachments${process.platform === 'win32' ? '\\' : '/'}`) ||
    within.startsWith('..')
  )
    throw new Error('Scanner proof refuses storage outside owned attachments')
  return path
}
async function listed(context: BrowserContext, card: string) {
  const response = await context.request.get(`/api/v1/cards/${card}/attachments`)
  expect(response.status()).toBe(200)
  return response.json() as Promise<{ id: string; name: string }[]>
}
async function fixture(browser: Browser) {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  await loginAsSuperAdmin(admin)
  await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('scanner.head'),
    headPassword: examplePassword(),
    departmentName: 'Local scanner QA',
  })
  expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const owner = (await (await head.request.get('/api/v1/me')).json()).user.id as string
  const created = await authedPost(head, '/api/v1/cards', {
    title: 'Scanned local files',
    assigneeUserId: owner,
  })
  expect(created.status()).toBe(201)
  const card = (await created.json()).id as string
  const external: string[] = []
  await head.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
      external.push(host)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const page = await head.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/work/card?id=${card}`)
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Scanned local files',
  )
  const section = page.getByRole('region', { name: 'Files', exact: true })
  await expect(section).toBeVisible()
  return {
    admin,
    head,
    page,
    card,
    section,
    input: section.locator('input[type=file]'),
    external,
    errors,
  }
}

test('real clamd publishes clean bytes and rejects the harmless antivirus test file', async ({
  browser,
}, info) => {
  const { admin, head, page, card, section, input, external, errors } = await fixture(browser)
  try {
    const bytes = Buffer.from('October management report\nCompleted,42\n')
    const clean = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/finalize'),
    )
    await input.setInputFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: bytes })
    expect((await clean).status()).toBe(200)
    await expect(section.getByRole('link', { name: 'report.txt', exact: true })).toBeVisible()
    const [row] = metadata(card)
    expect(row).toMatchObject({ scan_status: 'clean', status: 'finalized', deleted_at: null })
    expect(readFileSync(stored(row!.key))).toEqual(bytes)
    expect(existsSync(stored(row!.upload_key))).toBe(false)
    const download = await head.request.get(`/api/v1/cards/${card}/attachments/${row!.id}/download`)
    expect(download.status()).toBe(200)
    expect(await download.body()).toEqual(bytes)

    // Standard harmless EICAR sample assembled in memory; no fixture file or custom verdict.
    const sample = Buffer.from(
      ['X5O!P%@AP[4', '\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''),
    )
    const infected = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/finalize'),
    )
    await input.setInputFiles({
      name: 'antivirus-test.txt',
      mimeType: 'text/plain',
      buffer: sample,
    })
    expect((await infected).status()).toBe(422)
    await expect(section.getByRole('alert')).toBeVisible()
    await expect(
      section.getByRole('link', { name: 'antivirus-test.txt', exact: true }),
    ).toHaveCount(0)
    const rejected = metadata(card).find((record) => record.id !== row!.id)!
    expect(rejected).toMatchObject({ scan_status: 'infected', status: 'infected' })
    expect(rejected.deleted_at).toBeTruthy()
    expect(existsSync(stored(rejected.upload_key))).toBe(false)
    expect(
      (
        await head.request.get(`/api/v1/cards/${card}/attachments/${rejected.id}/download`)
      ).status(),
    ).toBe(404)
    expect(await listed(head, card)).toEqual([
      expect.objectContaining({ id: row!.id, name: 'report.txt' }),
    ])
    mkdirSync(evidence, { recursive: true })
    await section.screenshot({ path: join(evidence, `${info.project.name}-infected-refused.png`) })
    await page.reload()
    await expect(section.getByRole('link', { name: 'report.txt', exact: true })).toBeVisible()
    await expect(
      section.getByRole('link', { name: 'antivirus-test.txt', exact: true }),
    ).toHaveCount(0)
    expect(external).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await head.close()
    await admin.close()
  }
})

test('actual scanner outage fails closed and Retry publishes exactly the same pending upload after recovery', async ({
  browser,
}, info) => {
  test.setTimeout(110_000) // Actual daemon restart reloads the image's signature database.
  const state = JSON.parse(readFileSync(FLOW_SCANNER_FILE, 'utf8')) as FlowScannerState
  if (state.container.namespace !== FLOW_DB_NAME)
    throw new Error('Refusing a foreign scanner namespace')
  const { admin, head, page, card, section, input, external, errors } = await fixture(browser)
  let stopped = false
  try {
    controlOwnedContainer(state.container, 'stop')
    stopped = true
    const bytes = Buffer.from('Report uploaded while the scanner restarts\n')
    const refused = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/finalize'),
    )
    await input.setInputFiles({ name: 'retry-report.txt', mimeType: 'text/plain', buffer: bytes })
    expect((await refused).status()).toBe(503)
    await expect(section.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    expect(await listed(head, card)).toEqual([])
    const [pending] = metadata(card)
    expect(pending).toMatchObject({ scan_status: 'pending', status: 'pending', deleted_at: null })
    expect(readFileSync(stored(pending!.upload_key))).toEqual(bytes)
    expect(
      (
        await head.request.get(`/api/v1/cards/${card}/attachments/${pending!.id}/download`)
      ).status(),
    ).toBe(404)
    mkdirSync(evidence, { recursive: true })
    await section.screenshot({ path: join(evidence, `${info.project.name}-scanner-outage.png`) })
    controlOwnedContainer(state.container, 'start')
    stopped = false
    await waitForFlowScanner(state.port)
    const accepted = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/finalize'),
    )
    await section.getByRole('button', { name: 'Try again', exact: true }).click()
    expect((await accepted).status()).toBe(200)
    await expect(section.getByRole('link', { name: 'retry-report.txt', exact: true })).toBeVisible()
    const final = metadata(card)
    expect(final).toHaveLength(1)
    expect(final[0]).toMatchObject({ id: pending!.id, scan_status: 'clean', status: 'finalized' })
    expect(readFileSync(stored(final[0]!.key))).toEqual(bytes)
    expect(existsSync(stored(pending!.upload_key))).toBe(false)
    await page.reload()
    await expect(section.getByRole('link', { name: 'retry-report.txt', exact: true })).toBeVisible()
    await section.screenshot({ path: join(evidence, `${info.project.name}-retry-scanned.png`) })
    expect(external).toEqual([])
    expect(errors).toEqual([])
  } finally {
    if (stopped) {
      controlOwnedContainer(state.container, 'start')
      await waitForFlowScanner(state.port)
    }
    await head.close()
    await admin.close()
  }
})
