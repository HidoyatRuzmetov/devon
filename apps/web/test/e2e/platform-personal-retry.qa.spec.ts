import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

for (const kind of ['notes', 'canvases'] as const) {
  test(`@qa ${kind} explicit conflict retry retains newer typing behind its committed response`, async ({
    browser,
  }) => {
    const context = await newFlowContext(browser)
    let release: () => void = () => undefined
    try {
      await login(context, { login: 'demo.xodim', password: qaExampleCredential1 })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      const initialTitle = `Retry typing ${kind} ${randomUUID()}`
      const endpoint = `/api/v1/personal/${kind}`
      const response = await authedPost(context, endpoint, { title: initialTitle })
      expect(response.status()).toBe(201)
      const created = (await response.json()) as { id: string; version: number }
      const latestTitle = `Latest title typed while retrying ${created.id}`
      const path = `${endpoint}/${created.id}`
      const page = await context.newPage()
      await page.goto('/personal')
      await page
        .getByRole('tab', { name: kind === 'notes' ? 'Notes' : 'Canvas', exact: true })
        .click()
      if (kind === 'canvases')
        await page
          .getByRole('listitem')
          .filter({ has: page.getByText(initialTitle, { exact: true }) })
          .getByRole('button', { name: 'Open', exact: true })
          .click()
      const surface =
        kind === 'notes'
          ? page.locator(`[data-personal-note-id="${created.id}"]`)
          : page.locator('main')
      const title = surface.getByRole('textbox', {
        name: kind === 'notes' ? 'Note title' : 'Canvas title',
        exact: true,
      })
      const blurTarget =
        kind === 'notes'
          ? surface.getByRole('textbox', { name: 'Note body', exact: true })
          : surface.getByRole('button', { name: 'Share this canvas', exact: true })
      await title.fill('My retained conflicting title')
      expect(
        (
          await authedPatch(context, path, { version: created.version, title: 'Another tab title' })
        ).status(),
      ).toBe(200)
      const refused = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && new URL(res.url()).pathname === path,
      )
      await blurTarget.focus()
      expect((await refused).status()).toBe(409)
      await expect(surface.getByRole('alert')).toContainText('changed elsewhere')
      await expect(title).toHaveValue('My retained conflicting title')

      const read = async () => {
        if (kind === 'canvases') return (await context.request.get(path)).json()
        const notes = await (await context.request.get(endpoint)).json()
        return notes.find((note: { id: string }) => note.id === created.id)
      }
      await expect.poll(async () => (await read()).title).toBe('Another tab title')
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const versions: number[] = []
      const statuses: number[] = []
      let committed = 0
      page.on('response', (res) => {
        if (res.request().method() === 'PATCH' && new URL(res.url()).pathname === path)
          statuses.push(res.status())
      })
      await page.route(`**${path}`, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        versions.push(route.request().postDataJSON().version)
        const actual = await route.fetch()
        if (versions.length === 1) {
          expect(actual.status()).toBe(200)
          committed += 1
          await gate
        }
        await route.fulfill({ response: actual })
      })
      await surface.getByRole('button', { name: 'Retry save', exact: true }).click()
      await expect.poll(() => committed).toBe(1)
      expect((await read()).title).toBe('My retained conflicting title')
      await title.fill(latestTitle)
      await blurTarget.focus()
      expect(versions).toEqual([created.version + 1])
      release()
      await expect.poll(() => statuses).toEqual([200, 200])
      expect(versions).toEqual([created.version + 1, created.version + 2])
      expect(await read()).toMatchObject({
        title: latestTitle,
        version: created.version + 3,
      })
      await expect(title).toHaveValue(latestTitle)
      await expect(surface.getByRole('alert')).toHaveCount(0)
      await page.reload()
      await page
        .getByRole('tab', { name: kind === 'notes' ? 'Notes' : 'Canvas', exact: true })
        .click()
      if (kind === 'canvases')
        await page
          .getByRole('listitem')
          .filter({ has: page.getByText(latestTitle, { exact: true }) })
          .getByRole('button', { name: 'Open', exact: true })
          .click()
      await expect(title).toHaveValue(latestTitle)
    } finally {
      release()
      await context.close()
    }
  })
}
