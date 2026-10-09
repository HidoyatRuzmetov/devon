import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { FLOW_DB_CONTAINER, FLOW_DB_HOST, FLOW_DB_NAME, FLOW_DB_PORT } from './flow-env.js'
import { assertLocalTestDatabase } from './flow-safety.js'
import { assertLocalDockerEndpoint } from './flow-services.js'

const examplePassword = 'Ishonchli#2026'

async function expireOnlyThisSession(context: BrowserContext): Promise<void> {
  assertLocalTestDatabase({
    host: FLOW_DB_HOST,
    database: FLOW_DB_NAME,
    container: FLOW_DB_CONTAINER,
    port: FLOW_DB_PORT,
  })
  if (FLOW_DB_NAME !== 'devon_flow_e2e_knowledge_nested')
    throw new Error('Session-expiry probe requires its exact owned local namespace')
  const dockerContext = spawnSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  )
  expect(dockerContext.status).toBe(0)
  assertLocalDockerEndpoint(dockerContext.stdout.trim())
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
  const cookie = (await context.cookies()).find((value) => value.name === 'devon_sid')
  if (!cookie) throw new Error('Signed synthetic session required')
  const digest = createHash('sha256').update(cookie.value).digest('hex')
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      FLOW_DB_CONTAINER,
      'psql',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      FLOW_DB_NAME,
    ],
    {
      input: `with expired as (update app.sessions set expires_at = now() - interval '1 minute' where token_hash = decode('${digest}', 'hex') returning id) select count(*) from expired;`,
      encoding: 'utf8',
    },
  )
  // Never attach the cookie, its digest, SQL or database stderr to browser evidence.
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe('1')
}

function observe(page: Page) {
  const responses: { path: string; method: string; status: number }[] = []
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (['/api/v1/me', '/api/v1/board', '/api/v1/cards'].includes(path))
      responses.push({ path, method: response.request().method(), status: response.status() })
  })
  return responses
}

for (const operation of ['read', 'mutation'] as const) {
  test(`@qa expired local session recovers from ordinary board ${operation}`, async ({
    browser,
  }) => {
    const context = await newFlowContext(browser)
    const page = await context.newPage()
    const responses = observe(page)
    try {
      await login(context, { login: 'demo.boshliq', password: examplePassword })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      await page.goto(operation === 'mutation' ? '/work?new=1' : '/work')
      await expect(page.locator('[data-dnd-card]').first()).toBeVisible()
      if (operation === 'mutation')
        await page
          .getByRole('dialog')
          .getByRole('textbox', { name: 'Title', exact: true })
          .fill('Expired session owned probe')
      const before = responses.length
      await expireOnlyThisSession(context)
      const refused = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            (operation === 'read' ? '/api/v1/board' : '/api/v1/cards') &&
          response.request().method() === (operation === 'read' ? 'GET' : 'POST') &&
          response.status() === 401,
        { timeout: 20_000 },
      )
      if (operation === 'mutation')
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'New card', exact: true })
          .click()
      await refused
      try {
        await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 5_000 })
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
        await page.screenshot({ path: test.info().outputPath('recovered-sign-in.png') })
        await page
          .getByRole('textbox', { name: 'Login or email', exact: true })
          .fill('demo.boshliq')
        await page.getByLabel('Password', { exact: true }).fill(examplePassword)
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
        await expect(page).toHaveURL(/\/$/)
        await page.getByRole('link', { name: 'Cards', exact: true }).click()
        await expect(page.locator('[data-dnd-card]').first()).toBeVisible()
      } finally {
        await page.screenshot({ path: test.info().outputPath(`expired-${operation}.png`) })
        const state = {
          operation,
          url: new URL(page.url()).pathname,
          meReadsAfterExpiry: responses
            .slice(before)
            .filter((value) => value.path === '/api/v1/me'),
          responsesAfterExpiry: responses.slice(before),
          genericRecovery: await page
            .getByRole('button', { name: 'Try again', exact: true })
            .count(),
          createError: await page.getByText('Could not create the card', { exact: true }).count(),
        }
        await page.reload()
        const signedInAgain = responses
          .slice(before)
          .some((value) => value.path === '/api/v1/me' && value.status === 200)
        if (signedInAgain) await expect(page.locator('[data-dnd-card]').first()).toBeVisible()
        else {
          await expect(page).toHaveURL(/\/login(?:\?|$)/)
          await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
        }
        await test.info().attach('expired-session-observation', {
          body: JSON.stringify({ ...state, reloadRecovered: true, signedInAgain }, null, 2),
          contentType: 'application/json',
        })
      }
    } finally {
      await context.close()
    }
  })
}
