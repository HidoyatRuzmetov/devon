// Smoke-check only the isolated synthetic review instance; never an environment-selected URL.
import { chromium, expect } from '../../apps/web/node_modules/@playwright/test/index.mjs'
import { resolve } from 'node:path'
import { DEMO_PASSWORD } from '../../packages/db/src/seed/fixtures.js'

process.env['FLOW_DB_NAME'] = 'devon_qa_workspace_review'
process.env['FLOW_API_PORT'] = '48921'
process.env['FLOW_WEB_PORT'] = '48922'
const { login, authedPatch, authedPost, csrfToken } =
  await import('../../apps/web/test/e2e/flow-api.js')
const browser = await chromium.launch()
const head = await browser.newContext({ baseURL: 'http://127.0.0.1:48922' })
const member = await browser.newContext({ baseURL: 'http://127.0.0.1:48922' })
try {
  for (const [context, name] of [
    [head, 'demo.boshliq'],
    [member, 'demo.xodim'],
  ] as const) {
    await login(context, { login: name, password: DEMO_PASSWORD })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  }
  const me = await (await head.request.get('/api/v1/me')).json()
  const existing = await (
    await head.request.get('/api/v1/cards?assigneeUserId=' + me.user.id)
  ).json()
  {
    const create = async (title: string, priority = 'none') => {
      const found = existing.items.find((card: { title: string }) => card.title === title)
      if (found) return found.id as string
      const response = await authedPost(head, '/api/v1/cards', {
        title,
        priority,
        assigneeUserId: me.user.id,
      })
      expect(response.status(), await response.text()).toBe(201)
      return (await response.json()).id as string
    }
    const active = await create('Review the next release', 'high')
    const detail = await (await head.request.get(`/api/v1/cards/${active}`)).json()
    let item = detail.checklist.find(
      (row: { text: string }) => row.text === 'Review the By person view',
    )
    if (!item) {
      const checklist = await authedPost(head, `/api/v1/cards/${active}/checklist`, {
        text: 'Review the By person view',
      })
      expect(checklist.status()).toBe(201)
      item = await checklist.json()
    }
    const comments = await (
      await head.request.get(`/api/v1/cards/${active}/checklist/${item.id}/comments`)
    ).json()
    if (!comments.length)
      expect(
        (
          await authedPost(head, `/api/v1/cards/${active}/checklist/${item.id}/comments`, {
            text: 'This comment follows the checklist item into Cards, Projects and Check-in.',
          })
        ).status(),
      ).toBe(201)
    if (
      !detail.checklist.some(
        (row: { text: string }) => row.text === 'Try pinning and restoring a card',
      )
    )
      expect(
        (
          await authedPost(head, `/api/v1/cards/${active}/checklist`, {
            text: 'Try pinning and restoring a card',
          })
        ).status(),
      ).toBe(201)
    expect((await authedPost(head, '/api/v1/work/focus', { cardId: active })).status()).toBe(204)
    const doing = await create('Prepare the team meeting', 'medium')
    expect(
      (await authedPatch(head, `/api/v1/cards/${doing}`, { workStage: 'in_progress' })).status(),
    ).toBe(200)
    const done = await create('Confirm the review checklist', 'low')
    expect((await authedPatch(head, `/api/v1/cards/${done}`, { status: 'done' })).status()).toBe(
      200,
    )
    const deleted = await create('Previous release draft')
    expect(
      (
        await head.request.delete(`/api/v1/cards/${deleted}`, {
          headers: { 'x-csrf-token': await csrfToken(head) },
        })
      ).status(),
    ).toBe(204)
  }
  const page = await head.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/work/person')
  await expect(page.getByRole('combobox', { name: 'Choose person', exact: true })).toContainText(
    'Anvar Aliyev',
  )
  await expect(page.locator('[data-person-card]').first()).toBeVisible()
  await page.screenshot({
    path: resolve(import.meta.dirname, '../../artifacts/review/2026-11-05/local-preview.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
  console.log(
    'Local preview verified: demo head/member login, four lifecycle examples, shared checklist comment, own pin, and By person chooser.',
  )
} finally {
  await head.close()
  await member.close()
  await browser.close()
}
