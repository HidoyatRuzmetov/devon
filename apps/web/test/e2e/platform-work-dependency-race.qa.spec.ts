import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
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

test('@qa simultaneous opposing browser dependency writes cannot persist a cycle', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const first = await newFlowContext(browser)
  const second = await newFlowContext(browser)
  try {
    await Promise.all([
      login(first, { login: 'demo.boshliq', password: examplePassword }),
      login(second, { login: 'demo.boshliq', password: examplePassword }),
    ])
    expect((await authedPatch(first, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const suffix = randomUUID().slice(0, 8)
    const firstTitle = `QA opposed first ${suffix}`
    const secondTitle = `QA opposed second ${suffix}`
    async function create(title: string): Promise<string> {
      const response = await authedPost(first, '/api/v1/cards', { title, kind: 'task' })
      expect(response.status()).toBe(201)
      return ((await response.json()) as { id: string }).id
    }
    const firstId = await create(firstTitle)
    const secondId = await create(secondTitle)
    const firstPage = await first.newPage()
    const secondPage = await second.newPage()
    async function prepare(page: Page, id: string, title: string, otherTitle: string) {
      await page.goto(`/work?card=${id}`)
      await waitForLoadedRoute(page, '/work')
      await expect(
        page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true }),
      ).toHaveValue(title)
      const toggle = page.locator(`button[aria-controls="card-deps-${id}"]`)
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
      const panel = page.locator(`[id="card-deps-${id}"]`)
      await panel.getByRole('button', { name: label('work.dependencies.add'), exact: true }).click()
      await panel.getByRole('combobox').click()
      await page
        .getByPlaceholder(label('work.dependencies.pickSearch'), { exact: true })
        .fill(otherTitle)
      const option = page.getByRole('option', { name: otherTitle, exact: true })
      await expect(option).toBeVisible()
      await expect(option).not.toHaveAttribute('aria-disabled', 'true')
      return { panel, option }
    }
    const [firstUi, secondUi] = await Promise.all([
      prepare(firstPage, firstId, firstTitle, secondTitle),
      prepare(secondPage, secondId, secondTitle, firstTitle),
    ])
    let release: (() => void) | undefined
    const together = new Promise<void>((resolveTogether) => {
      release = resolveTogether
    })
    let arrivals = 0
    async function synchronize(page: Page, id: string): Promise<void> {
      await page.route(`**/api/v1/cards/${id}/dependencies`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        arrivals++
        if (arrivals === 2) release?.()
        await together
        await route.continue()
      })
    }
    await Promise.all([synchronize(firstPage, firstId), synchronize(secondPage, secondId)])
    const responses = Promise.all([
      firstPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/cards/${firstId}/dependencies`) &&
          response.request().method() === 'POST',
      ),
      secondPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/cards/${secondId}/dependencies`) &&
          response.request().method() === 'POST',
      ),
    ])
    await Promise.all([firstUi.option.click(), secondUi.option.click()])
    const result = await responses
    const graphResponse = await first.request.get('/api/v1/work/dependencies')
    expect(graphResponse.status()).toBe(200)
    const graph = (await graphResponse.json()) as { cardId: string; blockedByCardId: string }[]
    const pair = graph.filter(
      (edge) =>
        (edge.cardId === firstId && edge.blockedByCardId === secondId) ||
        (edge.cardId === secondId && edge.blockedByCardId === firstId),
    )
    await Promise.all([
      firstPage.screenshot({ path: test.info().outputPath('first-opposing-result.png') }),
      secondPage.screenshot({ path: test.info().outputPath('second-opposing-result.png') }),
    ])
    writeFileSync(
      test.info().outputPath('opposing-results.json'),
      JSON.stringify(
        {
          statuses: result.map((response) => response.status()),
          arrivals,
          persistedEdges: pair,
          boundary:
            'Two real browser operations; both actual POST requests are released together to the real server. No response injection.',
        },
        null,
        2,
      ),
    )
    expect(result.map((response) => response.status()).sort()).toEqual([201, 422])
    expect(pair).toHaveLength(1)
    const loser = result[0]!.status() === 422 ? firstPage : secondPage
    await expect(
      loser.getByText(label('work.dependencies.addFailed'), { exact: true }),
    ).toBeVisible()
    const loserId = result[0]!.status() === 422 ? firstId : secondId
    const cycleTitle = result[0]!.status() === 422 ? secondTitle : firstTitle
    await loser.locator(`[id="card-deps-${loserId}"]`).getByRole('combobox').click()
    await loser
      .getByPlaceholder(label('work.dependencies.pickSearch'), { exact: true })
      .fill(cycleTitle)
    await expect(
      loser.getByRole('option', {
        name: `${cycleTitle} ${label('work.dependencies.wouldLoop')}`,
        exact: true,
      }),
    ).toHaveAttribute('aria-disabled', 'true')
    await loser.screenshot({ path: test.info().outputPath('refused-cycle-choice.png') })
  } finally {
    await Promise.all([first.close(), second.close()])
  }
})
