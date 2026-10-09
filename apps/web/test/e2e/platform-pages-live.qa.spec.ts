import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { authedPatch, login, newFlowContext } from './flow-api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

function observe(page: Page) {
  const state = { connected: 0, types: [] as string[], errors: [] as string[] }
  page.on('pageerror', (error) => state.errors.push(error.message))
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      for (const line of payload.toString().split('\n')) {
        let data: unknown
        try {
          data = JSON.parse(line)
        } catch {
          continue
        }
        for (const reply of Array.isArray(data) ? data : [data]) {
          if (reply?.connect?.client) state.connected++
          if (reply?.push?.pub?.data?.type) state.types.push(reply.push.pub.data.type)
        }
      }
    }),
  )
  return state
}

test('@qa two open knowledge views receive committed create edit restore delete and undo', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const owner = await newFlowContext(browser)
  const colleague = await newFlowContext(browser)
  try {
    await login(owner, { login: 'demo.boshliq', password: qaExampleCredential1 })
    await login(colleague, { login: 'demo.xodim', password: qaExampleCredential1 })
    for (const context of [owner, colleague])
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    expect((await (await colleague.request.get('/api/v1/realtime/config')).json()).enabled).toBe(
      true,
    )
    const editor = await owner.newPage()
    const observer = await colleague.newPage()
    const wire = observe(observer)
    await Promise.all([editor.goto('/pages'), observer.goto('/pages')])
    await expect.poll(() => wire.connected).toBe(1)
    const initial = `Live knowledge ${randomUUID()}`
    const updated = `${initial} edited`
    await editor.getByRole('button', { name: 'New page', exact: true }).click()
    await editor.getByRole('textbox', { name: 'Page title', exact: true }).fill(initial)
    const createdReply = editor.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/pages',
    )
    await editor.locator('form').getByRole('button', { name: 'New page', exact: true }).click()
    const created = await createdReply
    expect(created.status()).toBe(201)
    const row = await created.json()
    const path = `/api/v1/pages/${row.id}`
    expect((await (await colleague.request.get(path)).json()).title).toBe(initial)
    await expect.poll(() => wire.types).toContain('pages.page.created')
    await expect(observer.getByText(initial, { exact: true })).toBeVisible()
    await observer.getByText(initial, { exact: true }).click()
    const title = editor.getByRole('textbox', { name: 'Title', exact: true })
    await expect(title).toHaveValue(initial)
    await title.fill(updated)
    await title.press('Tab')
    await expect
      .poll(async () => (await (await owner.request.get(path)).json()).title)
      .toBe(updated)
    await expect(observer.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(updated)
    await expect.poll(() => wire.types).toContain('pages.page.updated')
    const history = editor
      .getByRole('heading', { name: 'Version history', exact: true })
      .locator('..')
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await history.getByRole('listitem').last().getByRole('button').first().click()
    const restoredReply = editor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${path}/versions/restore` &&
        response.request().method() === 'POST',
    )
    await history.getByRole('button', { name: 'Restore this version', exact: true }).click()
    expect((await restoredReply).status()).toBe(200)
    expect((await (await colleague.request.get(path)).json()).title).toBe(initial)
    await expect(observer.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(initial)
    await expect.poll(() => wire.types).toContain('pages.page.version_restored')
    await observer.getByRole('button', { name: /Back to pages/ }).click()
    await expect(observer.getByText(initial, { exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'More actions', exact: true }).click()
    const deletedReply = editor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'DELETE',
    )
    await editor.getByRole('menuitem', { name: 'Delete page', exact: true }).click()
    expect((await deletedReply).status()).toBe(204)
    expect((await colleague.request.get(path)).status()).toBe(404)
    await expect(observer.getByText(initial, { exact: true })).toHaveCount(0)
    await expect.poll(() => wire.types).toContain('pages.page.deleted')
    const undoReply = editor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${path}/restore` &&
        response.request().method() === 'POST',
    )
    await editor.getByRole('button', { name: 'Undo', exact: true }).click()
    expect((await undoReply).status()).toBe(204)
    expect((await colleague.request.get(path)).status()).toBe(200)
    await expect(observer.getByText(initial, { exact: true })).toBeVisible()
    await expect.poll(() => wire.types).toContain('pages.page.restored')
    expect(wire.errors).toEqual([])
    await expect
      .poll(() =>
        observer.locator('main ul').evaluateAll((lists) =>
          lists.every((list) => {
            const rows = Array.from(list.querySelectorAll('li button')).map((row) =>
              row.getBoundingClientRect(),
            )
            return rows.every((row, i) => i === 0 || row.top >= rows[i - 1]!.bottom - 1)
          }),
        ),
      )
      .toBe(true)
    await observer.screenshot({
      path: test.info().outputPath('live-page-restored.png'),
      fullPage: true,
    })
    await test.info().attach('real-page-publications', {
      body: JSON.stringify(wire, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await Promise.all([owner.close(), colleague.close()])
  }
})

test('@qa open checklist settings receive peer changes while preserving a dirty local name', async ({
  browser,
}) => {
  const owner = await newFlowContext(browser)
  const peer = await newFlowContext(browser)
  const path = '/api/v1/pages/onboarding/templates'
  try {
    await Promise.all(
      [owner, peer].map(async (context) => {
        await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
        expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      }),
    )
    const editor = await owner.newPage()
    const observer = await peer.newPage()
    const wire = observe(observer)
    await Promise.all([
      editor.goto('/pages?tab=onboarding'),
      observer.goto('/pages?tab=onboarding'),
    ])
    await expect.poll(() => wire.connected).toBe(1)
    const card = (page: Page, name: string) =>
      page.getByRole('heading', { name, exact: true }).locator('..').locator('..')
    const initial = `Live checklist ${randomUUID()}`
    await editor.getByRole('textbox', { name: 'Checklist name', exact: true }).last().fill(initial)
    const creation = editor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'POST',
    )
    await editor.getByRole('button', { name: 'New checklist', exact: true }).click()
    const created = await creation
    expect(created.status()).toBe(201)
    const row = await created.json()
    const persisted = async () =>
      (await (await peer.request.get(path)).json()).find(
        (item: { id: string }) => item.id === row.id,
      )
    expect(await persisted()).toMatchObject({ name: initial, enabled: false })
    await expect(card(observer, initial)).toBeVisible()
    await expect.poll(() => wire.types).toContain('pages.onboarding_template.created')
    await card(observer, initial)
      .getByRole('button', { name: 'Edit checklist name', exact: true })
      .click()
    const localName = `Local checklist ${randomUUID()}`
    await card(observer, initial)
      .getByRole('textbox', { name: 'Checklist name', exact: true })
      .fill(localName)
    await card(editor, initial)
      .getByRole('button', { name: 'Edit checklist name', exact: true })
      .click()
    const peerName = `Peer checklist ${randomUUID()}`
    await card(editor, initial)
      .getByRole('textbox', { name: 'Checklist name', exact: true })
      .fill(peerName)
    await card(editor, initial).getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(persisted).toMatchObject({ name: peerName })
    const incoming = card(observer, peerName)
    await expect(
      incoming.getByRole('textbox', { name: 'Checklist name', exact: true }),
    ).toHaveValue(localName)
    await expect(incoming.getByRole('status')).toContainText('changed in another session')
    await incoming.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(persisted).toMatchObject({ name: localName, items: [] })
    await expect(card(editor, localName)).toBeVisible()
    await card(editor, localName).getByRole('switch', { name: 'Disabled', exact: true }).click()
    await expect.poll(persisted).toMatchObject({ enabled: true })
    await expect(
      card(observer, localName).getByRole('switch', { name: 'Enabled', exact: true }),
    ).toBeChecked()
    await card(editor, localName)
      .getByRole('button', { name: 'Delete checklist', exact: true })
      .click()
    const deleted = editor.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${path}/${row.id}` &&
        response.request().method() === 'DELETE',
    )
    await editor
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete checklist', exact: true })
      .click()
    expect((await deleted).status()).toBe(204)
    expect(await persisted()).toBeUndefined()
    await expect(observer.getByRole('heading', { name: localName, exact: true })).toHaveCount(0)
    await expect.poll(() => wire.types).toContain('pages.onboarding_template.deleted')
    expect(wire.errors).toEqual([])
    await test.info().attach('real-template-publications', {
      body: JSON.stringify(wire, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await Promise.all([owner.close(), peer.close()])
  }
})
