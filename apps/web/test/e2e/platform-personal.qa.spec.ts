import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

for (const kind of ['tasks', 'notes', 'canvases', 'completion'] as const) {
  test(`@qa personal ${kind} persists after leaving its tab`, async ({ browser }) => {
    const context = await newFlowContext(browser)
    try {
      await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      const resource = kind === 'completion' ? 'tasks' : kind
      const title = `Local QA navigation ${kind}`
      const response = await authedPost(context, `/api/v1/personal/${resource}`, { title })
      expect(response.status()).toBe(201)
      const created = (await response.json()) as { id: string }
      const page = await context.newPage()
      await page.goto('/personal')
      if (kind === 'completion') {
        const row = page.locator('li').filter({ has: page.getByText(title, { exact: true }) })
        await row.getByRole('checkbox', { name: 'Mark done', exact: true }).click()
        await expect(page.getByText('Marked done', { exact: true })).toBeVisible()
      } else if (kind === 'tasks') {
        await page.getByRole('tab', { name: 'To-dos', exact: true }).click()
        const input = page.locator(`input[value="${title}"]`)
        await input.locator('..').getByRole('button', { name: 'Delete to-do', exact: true }).click()
        await expect(page.getByText('To-do deleted', { exact: true })).toBeVisible()
      } else if (kind === 'notes') {
        await page.getByRole('tab', { name: 'Notes', exact: true }).click()
        const input = page.locator(`input[value="${title}"]`)
        await input.locator('..').getByRole('button', { name: 'Delete note', exact: true }).click()
        await expect(page.getByText('Note deleted', { exact: true })).toBeVisible()
      } else {
        await page.getByRole('tab', { name: 'Canvas', exact: true }).click()
        await page
          .getByText(title, { exact: true })
          .locator('..')
          .getByRole('button', { name: 'Delete canvas', exact: true })
          .click()
        await expect(page.getByText('Canvas deleted', { exact: true })).toBeVisible()
      }
      await page.getByRole('tab', { name: 'Periods', exact: true }).click()
      // The original implementation waits five seconds. Leaving the tab must not cancel a
      // change that the success toast has already announced.
      await page.waitForTimeout(6000)
      const persisted = (await (
        await context.request.get(`/api/v1/personal/${resource}`)
      ).json()) as { id: string; doneAt?: string | null }[]
      if (kind === 'completion')
        expect(persisted.find((item) => item.id === created.id)?.doneAt).toBeTruthy()
      else expect(persisted.some((item) => item.id === created.id)).toBe(false)
    } finally {
      await context.close()
    }
  })
}
