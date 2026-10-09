import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa Enter creates a persisted sibling of a nested to-do', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const parentResponse = await authedPost(context, '/api/v1/personal/tasks', {
      title: `Local QA sibling parent ${randomUUID()}`,
    })
    expect(parentResponse.status()).toBe(201)
    const parent = (await parentResponse.json()) as { id: string }
    const title = `Local QA nested anchor ${randomUUID()}`
    const childResponse = await authedPost(context, '/api/v1/personal/tasks', {
      title,
      parentId: parent.id,
    })
    expect(childResponse.status()).toBe(201)
    const child = (await childResponse.json()) as { id: string }
    const page = await context.newPage()
    const creationStatuses: number[] = []
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/personal/tasks'
      )
        creationStatuses.push(response.status())
    })
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    await page.locator(`input[value="${title}"]`).press('Enter')
    await expect.poll(() => creationStatuses).toContain(201)
    const persisted = (await (await context.request.get('/api/v1/personal/tasks')).json()) as {
      id: string
      parentId: string | null
      title: string
    }[]
    const sibling = persisted.find((item) => item.parentId === parent.id && item.id !== child.id)
    expect(sibling?.title).toBe('New to-do')
    await expect(
      page
        .locator(`[data-personal-task-id="${sibling!.id}"]`)
        .getByRole('textbox', { name: 'To-do title', exact: true }),
    ).toBeFocused()
  } finally {
    await context.close()
  }
})

test('@qa Tab leaves a personal title without changing its nesting', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const title = `Local QA keyboard title ${randomUUID()}`
    const response = await authedPost(context, '/api/v1/personal/tasks', { title, sort: 200 })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto('/personal')
    await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
    const input = page.locator(`input[value="${title}"]`)
    await input.focus()
    await page.keyboard.press('Tab')
    await expect(input).not.toBeFocused()
    expect(
      (
        (await (await context.request.get('/api/v1/personal/tasks')).json()) as {
          id: string
          parentId: string | null
        }[]
      ).find((item) => item.id === created.id)?.parentId,
    ).toBe(null)
    await input.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(input).not.toBeFocused()
  } finally {
    await context.close()
  }
})
