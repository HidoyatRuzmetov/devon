import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { waitForLoadedRoute } from './platform-capture.js'

const examplePassword = 'Ishonchli#2026'
function label(key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../packages/i18n/messages/en.generated.json'),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing en:${key}`)
  return value
}

test('@qa reopened dependency picker refreshes a concurrently changed graph', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: examplePassword })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const suffix = randomUUID().slice(0, 8)
    const title = `QA reopen graph ${suffix}`
    const candidateTitle = `QA new cycle ${suffix}`
    async function create(cardTitle: string): Promise<string> {
      const response = await authedPost(context, '/api/v1/cards', {
        title: cardTitle,
        kind: 'task',
      })
      expect(response.status()).toBe(201)
      return ((await response.json()) as { id: string }).id
    }
    const id = await create(title)
    const candidateId = await create(candidateTitle)
    const page = await context.newPage()
    let graphRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/work/dependencies') graphRequests++
    })
    await page.goto(`/work?card=${id}`)
    await waitForLoadedRoute(page, '/work')
    await expect(
      page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
    ).toHaveValue(title)
    const toggle = page.locator(`button[aria-controls="card-deps-${id}"]`)
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    const panel = page.locator(`[id="card-deps-${id}"]`)
    const add = panel.getByRole('button', { name: label('work.dependencies.add'), exact: true })
    const search = page.getByPlaceholder(label('work.dependencies.pickSearch'), { exact: true })
    const openedAt = Date.now()
    await add.click()
    await panel.getByRole('combobox').click()
    await search.fill(candidateTitle)
    const candidate = page.getByRole('option', { name: new RegExp(`^${candidateTitle}`) })
    await expect(candidate).toBeVisible()
    await expect(candidate).not.toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await panel.getByRole('button', { name: label('common.cancel'), exact: true }).click()
    const beforeReopenRequests = graphRequests
    expect(
      (
        await authedPost(context, `/api/v1/cards/${candidateId}/dependencies`, {
          blockedByCardId: id,
        })
      ).status(),
    ).toBe(201)
    const independent = await context.request.get(`/api/v1/cards/${candidateId}/dependencies`)
    expect(independent.status()).toBe(200)
    expect((await independent.json()).blockedBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ card: expect.objectContaining({ id }) })]),
    )
    await add.click()
    await panel.getByRole('combobox').click()
    await search.fill(candidateTitle)
    await expect(candidate).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('reopened-cycle-choice.png') })
    writeFileSync(
      test.info().outputPath('graph-freshness.json'),
      JSON.stringify(
        {
          beforeReopenRequests,
          afterReopenRequests: graphRequests,
          elapsedFromInitialOpenMs: Date.now() - openedAt,
          candidateDisabled: await candidate.getAttribute('aria-disabled'),
          candidateName: await candidate.textContent(),
          independentReverseEdge: { cardId: candidateId, blockedByCardId: id },
          boundary: 'Real separate API write while picker is closed; no transport fault injection',
        },
        null,
        2,
      ),
    )
    await expect(candidate).toHaveAttribute('aria-disabled', 'true')
    expect(graphRequests).toBeGreaterThan(beforeReopenRequests)
  } finally {
    await context.close()
  }
})
