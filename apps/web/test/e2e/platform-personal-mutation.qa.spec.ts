import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa a personal title conflict retains the draft for an explicit retry', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Task conflict ${randomUUID()}`,
    })
    expect(response.status()).toBe(201)
    const task = await response.json()
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    const row = page.locator(`[data-personal-task-id="${task.id}"]`)
    const title = row.getByRole('textbox', { name: 'To-do title', exact: true })
    await title.fill('My private task draft')
    expect(
      (
        await authedPatch(context, `/api/v1/personal/tasks/${task.id}`, {
          version: task.version,
          title: 'Task changed in another tab',
          notes: 'Preserve this remote note',
        })
      ).status(),
    ).toBe(200)
    const refresh = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        new URL(res.url()).pathname === '/api/v1/personal/tasks',
    )
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    expect((await refresh).status()).toBe(200)
    const refused = page.waitForResponse(
      (res) =>
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/tasks/${task.id}`,
    )
    await row.getByRole('checkbox', { name: 'Mark done', exact: true }).focus()
    expect((await refused).status()).toBe(409)
    await expect(row.getByRole('alert')).toContainText('changed elsewhere')
    await expect(title).toHaveValue('My private task draft')
    const first = await (await context.request.get('/api/v1/personal/tasks')).json()
    expect(first.find((item: { id: string }) => item.id === task.id)).toMatchObject({
      title: 'Task changed in another tab',
    })
    await row.getByRole('button', { name: 'Retry save', exact: true }).click()
    await expect
      .poll(async () => {
        const current = await (await context.request.get('/api/v1/personal/tasks')).json()
        return current.find((item: { id: string }) => item.id === task.id)
      })
      .toMatchObject({ title: 'My private task draft', notes: 'Preserve this remote note' })
    await expect(row.getByRole('alert')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('@qa an empty personal title has associated feedback and never sends a blank patch', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Blank task ${randomUUID()}`,
    })
    expect(response.status()).toBe(201)
    const task = await response.json()
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    let patches = 0
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === `/api/v1/personal/tasks/${task.id}`
      )
        patches++
    })
    const row = page.locator(`[data-personal-task-id="${task.id}"]`)
    const title = row.getByRole('textbox', { name: 'To-do title', exact: true })
    await title.fill('   ')
    await title.press('Enter')
    await expect(row.getByRole('alert')).toBeVisible()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(patches).toBe(0)
    await title.fill('Corrected private title')
    const saved = page.waitForResponse(
      (res) =>
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/tasks/${task.id}`,
    )
    await row.getByRole('checkbox', { name: 'Mark done', exact: true }).focus()
    expect((await saved).status()).toBe(200)
    const persisted = await (await context.request.get('/api/v1/personal/tasks')).json()
    expect(persisted.find((item: { id: string }) => item.id === task.id)?.title).toBe(
      'Corrected private title',
    )
  } finally {
    await context.close()
  }
})

test('@qa a moved task branch uses its atomic revisions for a queued child edit', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let release: () => void = () => undefined
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const periodRes = await authedPost(context, '/api/v1/personal/sprints', {
      kind: 'day',
      goal: `Move destination ${randomUUID()}`,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
    })
    expect(periodRes.status()).toBe(201)
    const period = await periodRes.json()
    const rootRes = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Move root ${randomUUID()}`,
    })
    expect(rootRes.status()).toBe(201)
    const root = await rootRes.json()
    const childRes = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Moved child ${randomUUID()}`,
      parentId: root.id,
    })
    expect(childRes.status()).toBe(201)
    const child = await childRes.json()
    const targetRes = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Destination task ${randomUUID()}`,
      sprintId: period.id,
    })
    expect(targetRes.status()).toBe(201)
    const target = await targetRes.json()
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    let moveCommitted = false
    let moveReceipt: unknown
    let childWrites = 0
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/personal/tasks/reorder?versions=true', async (route) => {
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      moveReceipt = await actual.json()
      moveCommitted = true
      await gate
      await route.fulfill({ response: actual })
    })
    await page.route(new RegExp(`/api/v1/personal/tasks/${child.id}(?:\\?.*)?$`), async (route) => {
      if (route.request().method() === 'PATCH') childWrites++
      await route.continue()
    })
    const rootRow = page.locator(`[data-personal-task-id="${root.id}"]`)
    const targetRow = page.locator(`[data-personal-task-id="${target.id}"]`)
    await rootRow.getByRole('button', { name: 'Drag to reorder', exact: true }).dragTo(targetRow)
    await expect.poll(() => moveCommitted).toBe(true)
    const childBox = page
      .locator(`[data-personal-task-id="${child.id}"]`)
      .getByRole('checkbox', { name: 'Mark done', exact: true })
    await childBox.click()
    expect(childWrites).toBe(0)
    const saved = page.waitForResponse(
      (res) =>
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/tasks/${child.id}`,
    )
    release()
    expect((await saved).status()).toBe(200)
    expect(moveReceipt).toMatchObject({
      affectedVersions: expect.arrayContaining([
        { id: child.id, beforeVersion: child.version, afterVersion: child.version + 1 },
      ]),
    })
    const rows = await (await context.request.get('/api/v1/personal/tasks')).json()
    expect(rows.find((row: { id: string }) => row.id === root.id)).toMatchObject({
      sprintId: period.id,
    })
    expect(rows.find((row: { id: string }) => row.id === child.id)).toMatchObject({
      sprintId: period.id,
      doneAt: expect.any(String),
    })
    await page.reload()
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    await expect(childBox).toHaveAttribute('aria-checked', 'true')
  } finally {
    release()
    await context.close()
  }
})

test('@qa a refused personal title save retains the draft and shows an error', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Personal title refusal ${randomUUID()}`,
    })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string; title: string }
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    await page.route(
      new RegExp(`/api/v1/personal/tasks/${created.id}(?:\\?.*)?$`),
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Controlled local task refusal',
            status: 503,
          }),
        })
      },
    )
    const row = page.locator(`[data-personal-task-id="${created.id}"]`)
    const input = row.getByRole('textbox', { name: 'To-do title', exact: true })
    await input.fill('Retained personal title draft')
    await row.getByRole('checkbox', { name: 'Mark done', exact: true }).focus()
    await expect(page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(input).toHaveValue('Retained personal title draft')
    const tasks = (await (await context.request.get('/api/v1/personal/tasks')).json()) as {
      id: string
      title: string
    }[]
    expect(tasks.find((item) => item.id === created.id)?.title).toBe(created.title)
  } finally {
    await context.close()
  }
})

test('@qa rapid personal completion changes preserve the latest intended state', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  let release: () => void = () => undefined
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Personal rapid completion ${randomUUID()}`,
    })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let writes = 0
    const statuses: number[] = []
    page.on('response', (res) => {
      if (
        res.request().method() === 'PATCH' &&
        new URL(res.url()).pathname === `/api/v1/personal/tasks/${created.id}`
      )
        statuses.push(res.status())
    })
    await page.route(
      new RegExp(`/api/v1/personal/tasks/${created.id}(?:\\?.*)?$`),
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        writes += 1
        const actual = await route.fetch()
        if (writes === 1) await gate
        await route.fulfill({ response: actual })
      },
    )
    const checkbox = page
      .locator(`[data-personal-task-id="${created.id}"]`)
      .getByRole('checkbox', { name: 'Mark done', exact: true })
    await checkbox.click()
    await expect.poll(() => writes).toBe(1)
    await expect
      .poll(async () => {
        const tasks = (await (await context.request.get('/api/v1/personal/tasks')).json()) as {
          id: string
          doneAt: string | null
        }[]
        return Boolean(tasks.find((item) => item.id === created.id)?.doneAt)
      })
      .toBe(true)
    await checkbox.click()
    await expect(checkbox).toHaveAttribute('aria-checked', 'false')
    expect(writes).toBe(1)
    release()
    await expect.poll(() => statuses).toEqual([200, 200])
    const tasks = (await (await context.request.get('/api/v1/personal/tasks')).json()) as {
      id: string
      doneAt: string | null
    }[]
    expect(tasks.find((item) => item.id === created.id)?.doneAt).toBe(null)
    await page.reload()
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    await expect(checkbox).toHaveAttribute('aria-checked', 'false')
  } finally {
    release()
    await context.close()
  }
})
