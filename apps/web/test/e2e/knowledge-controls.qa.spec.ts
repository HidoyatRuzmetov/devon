/* eslint-disable no-restricted-syntax -- Toolbar commands must execute sequentially on one browser page. */
import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  csrfToken,
  flowClientHeaders,
  login,
  loginAsSuperAdmin,
  newFlowContext,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

const templatesPath = '/api/v1/pages/onboarding/templates'
const examplePassword = 'Ishonchli#2026'
async function colleague(context: BrowserContext, role = 'demo.boshliq') {
  await login(context, { login: role, password: examplePassword })
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
}
async function createTemplate(context: BrowserContext) {
  const response = await authedPost(context, templatesPath, {
    name: `QA checklist ${randomUUID()}`,
    enabled: true,
    items: [{ id: 'original', text: 'Original instruction', ownerRole: 'newcomer' }],
  })
  expect(response.status()).toBe(201)
  return response.json()
}
function templateCard(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true }).locator('..').locator('..')
}

test('@qa failed checklist creation preserves input and offers visible recovery', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const name = page.getByRole('textbox', { name: 'Checklist name', exact: true })
    const draftName = `Refused checklist ${randomUUID()}`
    await name.fill(draftName)
    await page.route(`**${templatesPath}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({ status: 503, json: { title: 'Controlled refusal', status: 503 } })
    })
    await page.getByRole('button', { name: 'New checklist', exact: true }).click()
    await expect(page.locator('main').getByRole('alert')).toBeVisible()
    await expect(name).toHaveValue(draftName)
    await page.screenshot({ path: test.info().outputPath('create-refused.png'), fullPage: true })
    await page.unroute(`**${templatesPath}`)
    await page.getByRole('button', { name: 'New checklist', exact: true }).click()
    await expect(page.getByRole('heading', { name: draftName, exact: true })).toBeVisible()
    expect(
      (await (await context.request.get(templatesPath)).json()).filter(
        (row: { name: string }) => row.name === draftName,
      ),
    ).toHaveLength(1)
  } finally {
    await context.close()
  }
})

test('@qa creating another checklist after a second tab changes items retains the local draft', async ({
  browser,
}) => {
  const owner = await newFlowContext(browser)
  const peer = await newFlowContext(browser)
  try {
    await colleague(owner)
    await colleague(peer)
    const created = await createTemplate(owner)
    const page = await owner.newPage()
    await page.goto('/pages?tab=onboarding')
    const card = templateCard(page, created.name)
    await card
      .getByRole('textbox', { name: 'What needs to happen?', exact: true })
      .fill('Local unsaved instruction')
    await card.getByRole('button', { name: 'Add item', exact: true }).click()
    const peerPage = await peer.newPage()
    await peerPage.goto('/pages?tab=onboarding')
    await peerPage.bringToFront()
    const peerCard = templateCard(peerPage, created.name)
    await peerCard
      .getByRole('textbox', { name: 'What needs to happen?', exact: true })
      .fill('Other editor instruction')
    await peerCard.getByRole('button', { name: 'Add item', exact: true }).click()
    await peerCard.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await peer.request.get(templatesPath)).json()).find(
            (row: { id: string }) => row.id === created.id,
          )?.items.length,
      )
      .toBe(2)
    const refetched = page.waitForResponse(
      (res) => new URL(res.url()).pathname === templatesPath && res.request().method() === 'GET',
    )
    await page
      .getByRole('textbox', { name: 'Checklist name', exact: true })
      .fill(`Refresh checklist ${randomUUID()}`)
    await page.getByRole('button', { name: 'New checklist', exact: true }).click()
    await refetched
    await expect(card).toContainText('Local unsaved instruction')
    await page.screenshot({
      path: test.info().outputPath('incoming-items-draft.png'),
      fullPage: true,
    })
  } finally {
    await owner.close()
    await peer.close()
  }
})

test('@qa checklist role controls have accessible names', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const created = await createTemplate(context)
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    await expect(templateCard(page, created.name)).toBeVisible()
    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations).toEqual([])
  } finally {
    await context.close()
  }
})

test('@qa slash suggestions stay inside a short mobile viewport and support keyboard selection', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const response = await authedPost(context, '/api/v1/pages', {
      title: `QA slash ${randomUUID()}`,
      kind: 'note',
      blocks: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(response.status()).toBe(201)
    const created = await response.json()
    const page = await context.newPage()
    await page.setViewportSize({ width: 320, height: 480 })
    await page.goto(`/pages?page=${created.id}`)
    const body = page.locator('main [contenteditable="true"]')
    await body.fill('/')
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    const bounds = await list.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480)
    await page.screenshot({
      path: test.info().outputPath('slash-short-mobile.png'),
      fullPage: true,
    })
    await body.press('ArrowDown')
    await body.press('Enter')
    await expect(body.locator('h2')).toHaveCount(1)
    await expect(list).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks
            .content[0].type,
      )
      .toBe('heading')
    await page.reload()
    await expect(body.locator('h2')).toHaveCount(1)
  } finally {
    await context.close()
  }
})

test('@qa checklist editing, cancellation, toggle refusal and safe delete persist the intended record', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const created = await createTemplate(context)
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const card = templateCard(page, created.name)
    const item = card.getByRole('listitem').first()
    await item.getByRole('combobox').selectOption('buddy')
    await card.getByRole('button', { name: 'Cancel changes', exact: true }).click()
    await expect(item.getByRole('combobox')).toHaveValue('newcomer')
    await item.getByRole('button', { name: 'Edit item', exact: true }).click()
    const edit = item.getByRole('textbox', { name: 'Checklist item', exact: true })
    await expect(edit).toBeFocused()
    await edit.fill("Unicode O‘g‘il's edited instruction")
    await item.getByRole('combobox').selectOption('head')
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await context.request.get(templatesPath)).json()).find(
            (row: { id: string }) => row.id === created.id,
          )?.items[0],
      )
      .toMatchObject({ text: "Unicode O‘g‘il's edited instruction", ownerRole: 'head', sort: 0 })
    await page.reload()
    await expect(card).toContainText("Unicode O‘g‘il's edited instruction")
    await card.getByRole('button', { name: 'Edit checklist name', exact: true }).click()
    const renamed = `Renamed ${randomUUID()}`
    await card.getByRole('textbox', { name: 'Checklist name', exact: true }).fill(renamed)
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    const updatedCard = templateCard(page, renamed)
    await expect(updatedCard).toBeVisible()
    const path = `${templatesPath}/${created.id}`
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      return route.fulfill({
        status: 503,
        json: { title: 'Controlled toggle refusal', status: 503 },
      })
    })
    await updatedCard.getByRole('switch').click()
    await expect(updatedCard.getByRole('alert')).toBeVisible()
    await expect(updatedCard.getByRole('switch')).toBeChecked()
    expect(
      (await (await context.request.get(templatesPath)).json()).find(
        (row: { id: string }) => row.id === created.id,
      ).enabled,
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath('toggle-refused.png'), fullPage: true })
    await page.unroute(`**${path}`)
    await updatedCard.getByRole('switch').click()
    await expect(updatedCard.getByRole('switch')).not.toBeChecked()
    await expect
      .poll(
        async () =>
          (await (await context.request.get(templatesPath)).json()).find(
            (row: { id: string }) => row.id === created.id,
          ).enabled,
      )
      .toBe(false)
    await page.reload()
    await expect(updatedCard.getByRole('switch')).not.toBeChecked()
    await updatedCard.getByRole('switch').click()
    await expect(updatedCard.getByRole('switch')).toBeChecked()
    await expect
      .poll(
        async () =>
          (await (await context.request.get(templatesPath)).json()).find(
            (row: { id: string }) => row.id === created.id,
          ).enabled,
      )
      .toBe(true)
    await updatedCard.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      updatedCard.getByRole('button', { name: 'Delete checklist', exact: true }),
    ).toBeFocused()
    await updatedCard.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(
      updatedCard.getByRole('button', { name: 'Delete checklist', exact: true }),
    ).toBeFocused()
    await updatedCard.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await settleCapture(page, false)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(
      updatedCard.getByRole('button', { name: 'Delete checklist', exact: true }),
    ).toBeFocused()
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue()
      return route.fulfill({
        status: 503,
        json: { title: 'Controlled delete refusal', status: 503 },
      })
    })
    await updatedCard.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect(
      (await (await context.request.get(templatesPath)).json()).some(
        (row: { id: string }) => row.id === created.id,
      ),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath('delete-refused.png'), fullPage: true })
    await page.unroute(`**${path}`)
    await dialog.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    await expect(updatedCard).toHaveCount(0)
    await expect
      .poll(async () =>
        (await (await context.request.get(templatesPath)).json()).some(
          (row: { id: string }) => row.id === created.id,
        ),
      )
      .toBe(false)
    await expect(page.getByRole('textbox', { name: 'Checklist name', exact: true })).toBeFocused()
    await page.reload()
    await expect(updatedCard).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('@qa checklist slow duplicate creation, text boundaries and item cap prevent extra writes', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const name = page.getByRole('textbox', { name: 'Checklist name', exact: true })
    const create = page.getByRole('button', { name: 'New checklist', exact: true })
    await name.fill('   ')
    await expect(create).toBeDisabled()
    const maxName = `${randomUUID()} ${'Name '.repeat(40)}`.slice(0, 200)
    await name.fill(maxName)
    expect(await name.getAttribute('maxlength')).toBe('200')
    let release: (() => void) | undefined
    let requests = 0
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(`**${templatesPath}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      requests++
      const response = await route.fetch()
      await held
      await route.fulfill({ response })
    })
    await create.dblclick()
    await expect(name).toBeDisabled()
    await expect(create).toBeDisabled()
    await expect.poll(() => requests).toBe(1)
    release!()
    await expect(page.getByRole('heading', { name: maxName.trim(), exact: true })).toBeVisible()
    await page.unroute(`**${templatesPath}`)
    const rows = (await (await context.request.get(templatesPath)).json()).filter(
      (row: { name: string }) => row.name === maxName.trim(),
    )
    expect(rows).toHaveLength(1)
    const full = await authedPost(context, templatesPath, {
      name: `Full checklist ${randomUUID()}`,
      items: Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
        text: `Instruction ${i}`,
        ownerRole: 'newcomer',
      })),
    })
    expect(full.status()).toBe(201)
    const created = await full.json()
    await page.reload()
    const card = templateCard(page, created.name)
    await expect(card.getByRole('listitem')).toHaveCount(100)
    await expect(
      card.getByRole('textbox', { name: 'What needs to happen?', exact: true }),
    ).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Add item', exact: true })).toBeDisabled()
    await card
      .getByRole('listitem')
      .last()
      .getByRole('button', { name: 'Remove item', exact: true })
      .click()
    const input = card.getByRole('textbox', { name: 'What needs to happen?', exact: true })
    await expect(input).toBeFocused()
    await input.fill('X'.repeat(500))
    expect(await input.getAttribute('maxlength')).toBe('500')
    await card.getByRole('button', { name: 'Add item', exact: true }).click()
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(async () =>
        (await (await context.request.get(templatesPath)).json())
          .find((row: { id: string }) => row.id === created.id)
          ?.items.at(-1),
      )
      .toMatchObject({ text: 'X'.repeat(500), sort: 99 })
    await page.reload()
    await expect(card.getByRole('listitem')).toHaveCount(100)
  } finally {
    await context.close()
  }
})

test('@qa a stale checklist save preserves the draft and cancellation reloads the peer version', async ({
  browser,
}) => {
  const owner = await newFlowContext(browser)
  const peer = await newFlowContext(browser)
  try {
    await colleague(owner)
    await colleague(peer)
    const created = await createTemplate(owner)
    const page = await owner.newPage()
    const peerPage = await peer.newPage()
    await page.goto('/pages?tab=onboarding')
    await peerPage.goto('/pages?tab=onboarding')
    const card = templateCard(page, created.name)
    const peerCard = templateCard(peerPage, created.name)
    await card
      .getByRole('textbox', { name: 'What needs to happen?', exact: true })
      .fill('Local conflict draft')
    await card.getByRole('button', { name: 'Add item', exact: true }).click()
    await peerCard.getByRole('listitem').getByRole('combobox').selectOption('buddy')
    await peerCard.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await owner.request.get(templatesPath)).json()).find(
            (row: { id: string }) => row.id === created.id,
          )?.items[0].ownerRole,
      )
      .toBe('buddy')
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(card.getByRole('alert')).toBeVisible()
    await expect(card).toContainText('Local conflict draft')
    await expect(card.getByRole('status')).toContainText('changed in another session')
    await page.screenshot({ path: test.info().outputPath('template-conflict.png'), fullPage: true })
    await card.getByRole('button', { name: 'Cancel changes', exact: true }).click()
    await expect(card).not.toContainText('Local conflict draft')
    await expect(card.getByRole('listitem').getByRole('combobox')).toHaveValue('buddy')
    await page.reload()
    await expect(card.getByRole('listitem')).toHaveCount(1)
  } finally {
    await owner.close()
    await peer.close()
  }
})

test('@qa ordinary colleagues cannot manage onboarding templates through the UI or API', async ({
  browser,
}) => {
  const owner = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await colleague(owner)
    await colleague(member, 'demo.xodim')
    const created = await createTemplate(owner)
    const page = await member.newPage()
    await page.goto('/pages?tab=onboarding')
    await expect(
      page.getByRole('button', { name: 'Onboarding checklist', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Checklist name', exact: true })).toHaveCount(0)
    expect((await member.request.get(templatesPath)).status()).toBe(403)
    expect((await authedPost(member, templatesPath, { name: 'Forbidden template' })).status()).toBe(
      403,
    )
    expect(
      (
        await authedPatch(member, `${templatesPath}/${created.id}`, {
          version: created.version,
          enabled: false,
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await member.request.delete(`${templatesPath}/${created.id}`, {
          headers: { 'x-csrf-token': await csrfToken(member) },
        })
      ).status(),
    ).toBe(403)
    expect(
      (await (await owner.request.get(templatesPath)).json()).find(
        (row: { id: string }) => row.id === created.id,
      ),
    ).toMatchObject({ enabled: true, version: created.version })
  } finally {
    await owner.close()
    await member.close()
  }
})

test('@qa every rich-editor toolbar block and mark persists after reload', async ({ browser }) => {
  test.setTimeout(90_000)
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const page = await context.newPage()
    const commands = [
      ['Bold', 'bold'],
      ['Italic', 'italic'],
      ['Heading 1', 'heading'],
      ['Heading 2', 'heading'],
      ['Bullet list', 'bulletList'],
      ['Numbered list', 'orderedList'],
      ['Checklist', 'taskList'],
      ['Quote', 'blockquote'],
      ['Code block', 'codeBlock'],
      ['Callout', 'callout'],
    ] as const
    for (const [label, nodeType] of commands) {
      const response = await authedPost(context, '/api/v1/pages', {
        title: `QA ${label} ${randomUUID()}`,
        kind: 'note',
        blocks: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Editable paragraph' }] }],
        },
      })
      expect(response.status()).toBe(201)
      const created = await response.json()
      await page.goto(`/pages?page=${created.id}`)
      const body = page.getByRole('textbox', { name: 'Page content', exact: true })
      await body.click()
      await body.press('ControlOrMeta+a')
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect
        .poll(async () =>
          JSON.stringify(
            (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
          ),
        )
        .toContain(`"type":"${nodeType}"`)
      if (label === 'Checklist') {
        await body.getByRole('checkbox').check()
        await expect
          .poll(async () =>
            JSON.stringify(
              (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
            ),
          )
          .toContain('"checked":true')
      }
      await page.reload()
      await expect(body).toContainText('Editable paragraph')
      const saved = await (await context.request.get(`/api/v1/pages/${created.id}`)).json()
      expect(JSON.stringify(saved.blocks)).toContain(`"type":"${nodeType}"`)
      if (label === 'Checklist') {
        await expect(body.getByRole('checkbox')).toBeChecked()
        await body.getByRole('checkbox').uncheck()
        await expect
          .poll(async () =>
            JSON.stringify(
              (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
            ),
          )
          .toContain('"checked":false')
        await page.reload()
        await expect(body.getByRole('checkbox')).not.toBeChecked()
      }
    }
    await page.screenshot({
      path: test.info().outputPath('rich-editor-callout.png'),
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})

test('@qa filtered slash and mentions support pointer, arrows, empty results, Escape and Tab', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const response = await authedPost(context, '/api/v1/pages', {
      title: `QA suggestions ${randomUUID()}`,
      kind: 'note',
      blocks: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    const created = await response.json()
    const page = await context.newPage()
    await page.goto(`/pages?page=${created.id}`)
    const body = page.getByRole('textbox', { name: 'Page content', exact: true })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const replaceText = async (text: string) => {
      await body.click()
      await body.press('ControlOrMeta+a')
      await body.press('Backspace')
      await body.pressSequentially(text)
    }
    await replaceText('/heading')
    await page.getByRole('option', { name: 'Heading 2', exact: true }).click()
    await expect(body.locator('h2')).toHaveText('')
    await expect(body).not.toContainText('heading')
    await replaceText('/unmatchedxyz')
    await expect(page.getByRole('listbox')).toContainText('No matching options')
    await body.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await replaceText('')
    await expect
      .poll(
        async () =>
          (
            await (await context.request.get(`/api/v1/pages/${created.id}`)).json()
          ).blocks.content[0]?.content
            ?.map((node: { text?: string }) => node.text ?? '')
            .join('') ?? '',
      )
      .toBe('')
    await replaceText('/')
    await expect(page.getByRole('listbox')).toBeVisible()
    await body.press('ArrowUp')
    await expect(
      page.getByRole('listbox').getByRole('option', { name: 'Callout', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await body.press('ArrowDown')
    await expect(
      page.getByRole('listbox').getByRole('option', { name: 'Heading 1', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await body.press('Tab')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await replaceText('@')
    const options = page.getByRole('listbox').getByRole('option')
    await expect(options.first()).toBeVisible()
    const selectedName = await options.first().innerText()
    await replaceText(`@${selectedName.slice(0, 3)}`)
    await page.getByRole('option', { name: selectedName, exact: true }).click()
    await expect(body).toContainText(`@${selectedName}`)
    await expect(body).not.toContainText(selectedName.slice(0, 3) + selectedName.slice(0, 3))
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
        ),
      )
      .toContain('"type":"mention"')
    await page.reload()
    await expect(body).toContainText(`@${selectedName}`)
    await replaceText('@no-matching-colleague-xyz')
    await expect(page.getByRole('listbox')).toContainText('No matching options')
    await page.getByRole('textbox', { name: 'Title', exact: true }).click()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await replaceText('@no-matching-colleague-xyz')
    await expect(page.getByRole('listbox')).toContainText('No matching options')
    await body.press('Enter')
    await expect(body).toContainText('@no-matching-colleague-xyz')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath('mention-no-results-dismissed.png'),
      fullPage: true,
    })
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('@qa contextual tooltip focus and all eight slash choices are discoverable and persist', async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const created = await createTemplate(context)
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const card = templateCard(page, created.name)
    const toggle = card.getByRole('switch')
    await toggle.scrollIntoViewIfNeeded()
    await settleCapture(page, false)
    await toggle.focus()
    await toggle.press('Tab')
    const rename = card.getByRole('button', { name: 'Edit checklist name', exact: true })
    await expect(rename).toBeFocused()
    await expect(page.getByRole('tooltip')).toContainText('Edit checklist name')
    await rename.press('Shift+Tab')
    await expect(toggle).toBeFocused()
    await toggle.press('Tab')
    await rename.press('Enter')
    await expect(card.getByRole('textbox', { name: 'Checklist name', exact: true })).toBeFocused()
    await card.getByRole('button', { name: 'Cancel changes', exact: true }).click()
    await toggle.focus()
    await toggle.press('Tab')
    await rename.press('Tab')
    const removeChecklist = card.getByRole('button', { name: 'Delete checklist', exact: true })
    await expect(removeChecklist).toBeFocused()
    await removeChecklist.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await settleCapture(page, false)
    await page.mouse.click(10, 10)
    await expect(dialog).toHaveCount(0)
    await expect(removeChecklist).toBeFocused()
    await removeChecklist.press('Tab')
    await expect(card.getByRole('listitem').getByRole('combobox')).toBeFocused()
    await page.keyboard.press('Tab')
    const editItem = card.getByRole('button', { name: 'Edit item', exact: true })
    await expect(editItem).toBeFocused()
    await editItem.press('Enter')
    await expect(card.getByRole('textbox', { name: 'Checklist item', exact: true })).toBeFocused()
    await card.getByRole('button', { name: 'Cancel changes', exact: true }).click()
    await editItem.focus()
    await editItem.press('Tab')
    const removeItem = card.getByRole('button', { name: 'Remove item', exact: true })
    await expect(removeItem).toBeFocused()
    await removeItem.press('Enter')
    await expect(card.getByRole('listitem')).toHaveCount(0)
    await card.getByRole('button', { name: 'Cancel changes', exact: true }).click()
    await expect(card.getByRole('listitem')).toHaveCount(1)
    for (const label of ['Edit checklist name', 'Delete checklist', 'Edit item', 'Remove item']) {
      const control = card.getByRole('button', { name: label, exact: true })
      await control.scrollIntoViewIfNeeded()
      await page.mouse.move(1, 1)
      await settleCapture(page, false)
      await control.hover()
      const bounds = await control.boundingBox()
      // A native pointer enters then moves within the target. A one-event teleport may still be
      // consumed by Radix's previous tooltip grace area before its document listener clears it.
      await page.mouse.move(bounds!.x + bounds!.width / 2 + 1, bounds!.y + bounds!.height / 2)
      await expect(page.getByRole('tooltip', { name: label, exact: true })).toBeVisible()
      expect(bounds!.width).toBeGreaterThanOrEqual(24)
      expect(bounds!.height).toBeGreaterThanOrEqual(24)
    }
    await page.screenshot({
      path: test.info().outputPath('template-context-tooltip.png'),
      fullPage: true,
    })
    for (const [label, type] of [
      ['Heading 1', 'heading'],
      ['Heading 2', 'heading'],
      ['Bullet list', 'bulletList'],
      ['Numbered list', 'orderedList'],
      ['Checklist', 'taskList'],
      ['Quote', 'blockquote'],
      ['Code block', 'codeBlock'],
      ['Callout', 'callout'],
    ] as const) {
      const response = await authedPost(context, '/api/v1/pages', {
        title: `Slash ${label} ${randomUUID()}`,
        kind: 'note',
        blocks: { type: 'doc', content: [{ type: 'paragraph' }] },
      })
      const document = await response.json()
      await page.goto(`/pages?page=${document.id}`)
      const body = page.getByRole('textbox', { name: 'Page content', exact: true })
      await body.fill('/')
      await page.getByRole('listbox').getByRole('option', { name: label, exact: true }).click()
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(body).not.toContainText('/')
      await expect
        .poll(async () =>
          JSON.stringify(
            (await (await context.request.get(`/api/v1/pages/${document.id}`)).json()).blocks,
          ),
        )
        .toContain(`"type":"${type}"`)
      await page.reload()
      const saved = await (await context.request.get(`/api/v1/pages/${document.id}`)).json()
      expect(JSON.stringify(saved.blocks)).toContain(`"type":"${type}"`)
      const control = page.getByRole('button', { name: label, exact: true })
      await page.mouse.move(1, 1)
      await settleCapture(page, false)
      await control.hover()
      const bounds = await control.boundingBox()
      await page.mouse.move(bounds!.x + bounds!.width / 2 + 1, bounds!.y + bounds!.height / 2)
      await expect(page.getByRole('tooltip', { name: label, exact: true })).toBeVisible()
    }
  } finally {
    await context.close()
  }
})

test('@qa FAQ folds, searches, clears, keyboard opens answers and follows its work link', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context, 'demo.xodim')
    const page = await context.newPage()
    await page.goto('/pages')
    await page.getByRole('link', { name: /Quick help/ }).click()
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.locator('main details')).toHaveCount(10)
    await expect(page.locator('main details[open]')).toHaveCount(0)
    const first = page.locator('main summary').first()
    await first.focus()
    await first.press('Enter')
    await expect(page.locator('main details[open]')).toHaveCount(1)
    await expect(first).toBeFocused()
    const query = page.getByRole('searchbox')
    await query.fill('quiet hours')
    await expect(page.locator('main details')).toHaveCount(1)
    await expect(page.locator('main details[open]')).toHaveCount(1)
    await query.fill('zzznomatch')
    await expect(page.locator('main').getByRole('status')).toContainText('No matching answer')
    await query.fill('')
    await expect(page.locator('main details')).toHaveCount(10)
    await expect(page.locator('main details[open]')).toHaveCount(0)
    const destinations = [
      '/work/mine',
      '/work/workload',
      '/admin',
      '/work',
      '/projects',
      '/work/archive',
      '/work',
      '/account',
      '/account/telegram',
      '/ai',
    ]
    for (let index = 0; index < destinations.length; index++) {
      const answer = page.locator('main details').nth(index)
      await answer.locator('summary').click()
      await expect(answer).toHaveAttribute('open', '')
      await expect(answer.locator('p')).toBeVisible()
      await expect(answer.getByRole('link')).toHaveAttribute('href', destinations[index]!)
      await answer.locator('summary').click()
    }
    await first.click()
    await page.locator('main details').first().getByRole('link').click()
    await expect(page).toHaveURL(/\/work\/mine$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/help$/)
    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations).toEqual([])
  } finally {
    await context.close()
  }
})

test('@qa template validation, normalization and touch controls retain recoverable drafts', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: FLOW_WEB_BASE_URL,
    extraHTTPHeaders: flowClientHeaders(),
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  })
  try {
    await colleague(context)
    const created = await createTemplate(context)
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const card = templateCard(page, created.name)
    await card.getByRole('button', { name: 'Edit checklist name', exact: true }).tap()
    const name = card.getByRole('textbox', { name: 'Checklist name', exact: true })
    await name.fill('  ')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(card.getByRole('alert')).toContainText('Enter a checklist name')
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    const renamed = `Trimmed ${randomUUID()}`
    await name.fill(`  ${renamed}  `)
    await card.getByRole('listitem').getByRole('button', { name: 'Edit item', exact: true }).tap()
    const item = card.getByRole('textbox', { name: 'Checklist item', exact: true })
    await item.fill('  ')
    await expect(item).toHaveAttribute('aria-invalid', 'true')
    await expect(card.getByRole('alert')).toContainText('Enter an item')
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await item.fill('  A normalized instruction  ')
    const newItem = card.getByRole('textbox', { name: 'What needs to happen?', exact: true })
    await newItem.fill('  ')
    await expect(card.getByRole('button', { name: 'Add item', exact: true })).toBeDisabled()
    await newItem.fill('Instruction submitted with Enter')
    await newItem.press('Enter')
    await expect(card.getByRole('listitem')).toHaveCount(2)
    const path = `${templatesPath}/${created.id}`
    await page.route(`**${path}`, async (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 503, json: { title: 'Controlled edit refusal', status: 503 } })
        : route.continue(),
    )
    await card.getByRole('button', { name: 'Save', exact: true }).tap()
    await expect(card.getByRole('alert')).toBeVisible()
    await expect(name).toHaveValue(`  ${renamed}  `)
    await expect(item).toHaveValue('  A normalized instruction  ')
    await page.unroute(`**${path}`)
    await card.getByRole('button', { name: 'Save', exact: true }).tap()
    const savedCard = templateCard(page, renamed)
    await expect(savedCard).toBeVisible()
    await expect(savedCard.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect
      .poll(async () =>
        (await (await context.request.get(templatesPath)).json()).find(
          (row: { id: string }) => row.id === created.id,
        ),
      )
      .toMatchObject({
        name: renamed,
        items: [
          { id: 'original', text: 'A normalized instruction', ownerRole: 'newcomer', sort: 0 },
          { text: 'Instruction submitted with Enter', ownerRole: 'newcomer', sort: 1 },
        ],
      })
    await page.reload()
    await expect(savedCard).toContainText('A normalized instruction')
    await savedCard.getByRole('switch').tap()
    await expect(savedCard.getByRole('switch')).not.toBeChecked()
    await expect
      .poll(
        async () =>
          (await (await context.request.get(templatesPath)).json()).find(
            (row: { id: string }) => row.id === created.id,
          ).enabled,
      )
      .toBe(false)
    const response = await authedPost(context, '/api/v1/pages', {
      title: `Touch slash ${randomUUID()}`,
      kind: 'note',
      blocks: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    const document = await response.json()
    await page.goto(`/pages?page=${document.id}`)
    const body = page.getByRole('textbox', { name: 'Page content', exact: true })
    await body.fill('/quote')
    await page.getByRole('listbox').getByRole('option', { name: 'Quote', exact: true }).tap()
    await expect(body.locator('blockquote')).toHaveCount(1)
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/v1/pages/${document.id}`)).json()).blocks,
        ),
      )
      .toContain('blockquote')
  } finally {
    await context.close()
  }
})

test('@qa excluded AI boundary refuses translation without changing the ordinary editor', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const response = await authedPost(context, '/api/v1/pages', {
      title: `Unavailable translation ${randomUUID()}`,
      kind: 'note',
      blocks: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Text that must remain unchanged.' }],
          },
        ],
      },
    })
    const created = await response.json()
    const page = await context.newPage()
    let calls = 0
    await page.route('**/api/v1/ai/features/translate/run', async (route) => {
      calls++
      return route.fulfill({
        status: 503,
        json: { title: 'AI unavailable in local QA', status: 503 },
      })
    })
    await page.goto(`/pages?page=${created.id}`)
    const body = page.getByRole('textbox', { name: 'Page content', exact: true })
    await body.click()
    await body.press('ArrowLeft')
    const translate = page.getByRole('button', { name: 'Translate selection', exact: true })
    await translate.click()
    await expect(
      page.getByText('Select some text first, then translate it', { exact: true }),
    ).toBeVisible()
    expect(calls).toBe(0)
    const target = page.getByRole('combobox', { name: 'Into which language', exact: true })
    for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
      await target.selectOption(locale)
      await expect(target).toHaveValue(locale)
    }
    await target.selectOption('ru')
    await body.click()
    await body.press('ControlOrMeta+a')
    await translate.click()
    await expect(page.locator('main').getByRole('alert')).toContainText('could not translate')
    await expect.poll(() => calls).toBe(1)
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect.poll(() => calls).toBe(2)
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
    expect(
      (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
    ).toEqual(created.blocks)
    await body.click()
    await body.press('ControlOrMeta+a')
    await body.pressSequentially('Ordinary editing still works.')
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
        ),
      )
      .toContain('Ordinary editing still works.')
    await page.reload()
    await expect(body).toContainText('Ordinary editing still works.')
  } finally {
    await context.close()
  }
})

test('@qa deleting the last checklist shows the empty state and a fresh checklist can be created', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const rows = await (await context.request.get(templatesPath)).json()
    for (const row of rows as { id: string }[]) {
      expect(
        (
          await context.request.delete(`${templatesPath}/${row.id}`, {
            headers: { 'x-csrf-token': await csrfToken(context) },
          })
        ).status(),
      ).toBe(204)
    }
    const response = await authedPost(context, templatesPath, {
      name: `Last checklist ${randomUUID()}`,
      items: [],
    })
    const created = await response.json()
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const card = templateCard(page, created.name)
    await expect(card.getByRole('listitem')).toHaveCount(0)
    await card.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete checklist', exact: true })
      .click()
    await expect(card).toHaveCount(0)
    await expect
      .poll(async () => (await (await context.request.get(templatesPath)).json()).length)
      .toBe(0)
    const name = page.getByRole('textbox', { name: 'Checklist name', exact: true })
    await expect(name).toBeFocused()
    await page.reload()
    await expect(page.locator('main')).toContainText('No onboarding checklist yet')
    await page.screenshot({ path: test.info().outputPath('templates-empty.png'), fullPage: true })
    const nextName = `Fresh checklist ${randomUUID()}`
    await name.fill(nextName)
    await name.press('Enter')
    await expect(page.getByRole('region', { name: nextName, exact: true })).toBeVisible()
    expect(
      (await (await context.request.get(templatesPath)).json()).map(
        (row: { name: string }) => row.name,
      ),
    ).toEqual([nextName])
  } finally {
    await context.close()
  }
})

test('@qa duplicate checklist names remain distinct and slow edit and delete each submit once', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const duplicateName = `Same checklist ${randomUUID()}`
    const first = await authedPost(context, templatesPath, {
      name: duplicateName,
      items: [{ id: 'first', text: 'First record item', ownerRole: 'newcomer' }],
    })
    const second = await authedPost(context, templatesPath, {
      name: duplicateName,
      items: [{ id: 'second', text: 'Second record item', ownerRole: 'buddy' }],
    })
    const firstRow = await first.json()
    const secondRow = await second.json()
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const duplicateCards = page.getByRole('region', { name: duplicateName, exact: true })
    await expect(duplicateCards).toHaveCount(2)
    const secondIndex = await duplicateCards.evaluateAll((cards) =>
      cards.findIndex((card) => card.textContent?.includes('Second record item')),
    )
    expect(secondIndex).toBeGreaterThanOrEqual(0)
    const card = duplicateCards.nth(secondIndex)
    await card
      .getByRole('textbox', { name: 'What needs to happen?', exact: true })
      .fill('Unadded draft while saving')
    await card.getByRole('listitem').getByRole('button', { name: 'Edit item', exact: true }).click()
    await card
      .getByRole('textbox', { name: 'Checklist item', exact: true })
      .fill('Changed only the second record')
    const path = `${templatesPath}/${secondRow.id}`
    let patchRequests = 0
    let releasePatch: (() => void) | undefined
    const heldPatch = new Promise<void>((resolve) => {
      releasePatch = resolve
    })
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      patchRequests++
      const response = await route.fetch()
      await heldPatch
      return route.fulfill({ response })
    })
    await card.getByRole('button', { name: 'Save', exact: true }).dblclick()
    await expect(card.getByRole('switch')).toBeDisabled()
    await expect(card.getByRole('textbox', { name: 'Checklist item', exact: true })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Cancel changes', exact: true })).toBeDisabled()
    for (const label of [
      'Edit checklist name',
      'Delete checklist',
      'Edit item',
      'Remove item',
      'Add item',
    ])
      await expect(card.getByRole('button', { name: label, exact: true })).toBeDisabled()
    await expect(
      card.getByRole('textbox', { name: 'What needs to happen?', exact: true }),
    ).toBeDisabled()
    for (const role of await card.getByRole('combobox').all()) await expect(role).toBeDisabled()
    await expect.poll(() => patchRequests).toBe(1)
    releasePatch!()
    await expect(card.getByRole('textbox', { name: 'Checklist item', exact: true })).toHaveCount(0)
    await page.unroute(`**${path}`)
    const rows = await (await context.request.get(templatesPath)).json()
    expect(rows.find((row: { id: string }) => row.id === firstRow.id).items[0].text).toBe(
      'First record item',
    )
    expect(rows.find((row: { id: string }) => row.id === secondRow.id).items[0].text).toBe(
      'Changed only the second record',
    )
    const savedCard = page
      .getByRole('region', { name: duplicateName, exact: true })
      .filter({ hasText: 'Changed only the second record' })
    await savedCard.getByRole('button', { name: 'Delete checklist', exact: true }).click()
    const dialog = page.getByRole('dialog')
    let deleteRequests = 0
    let releaseDelete: (() => void) | undefined
    const heldDelete = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue()
      deleteRequests++
      const response = await route.fetch()
      await heldDelete
      return route.fulfill({ response })
    })
    await dialog.getByRole('button', { name: 'Delete checklist', exact: true }).dblclick()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    await page.mouse.click(10, 10)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect.poll(() => deleteRequests).toBe(1)
    releaseDelete!()
    await expect(savedCard).toHaveCount(0)
    await page.unroute(`**${path}`)
    await expect
      .poll(async () =>
        (await (await context.request.get(templatesPath)).json()).some(
          (row: { id: string }) => row.id === secondRow.id,
        ),
      )
      .toBe(false)
    expect(
      (await (await context.request.get(templatesPath)).json()).some(
        (row: { id: string }) => row.id === firstRow.id,
      ),
    ).toBe(true)
    await page.reload()
    await expect(page.getByRole('region', { name: duplicateName, exact: true })).toHaveCount(1)
    await expect(page.getByRole('region', { name: duplicateName, exact: true })).toContainText(
      'First record item',
    )
  } finally {
    await context.close()
  }
})

test('@qa each new-item role and edit text boundary persists through save and reload', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const created = await createTemplate(context)
    const page = await context.newPage()
    await page.goto('/pages?tab=onboarding')
    const card = templateCard(page, created.name)
    const newItem = card.getByRole('textbox', { name: 'What needs to happen?', exact: true })
    const newRole = card.getByRole('combobox', { name: 'Responsible role', exact: true })
    for (const role of ['buddy', 'head', 'newcomer']) {
      await newRole.selectOption(role)
      await expect(newRole).toHaveValue(role)
      await newItem.fill(`Instruction for ${role}`)
      await newItem.press('Enter')
    }
    await expect(card.getByRole('listitem')).toHaveCount(4)
    await card.getByRole('button', { name: 'Edit checklist name', exact: true }).click()
    const name = card.getByRole('textbox', { name: 'Checklist name', exact: true })
    const maxName = `${randomUUID()} ${'Name '.repeat(50)}`.slice(0, 200)
    await name.fill(maxName + 'extra characters')
    await expect(name).toHaveValue(maxName)
    const original = card.getByRole('listitem').first()
    await original.getByRole('button', { name: 'Edit item', exact: true }).click()
    const edit = original.getByRole('textbox', { name: 'Checklist item', exact: true })
    await edit.fill('X'.repeat(520))
    await expect(edit).toHaveValue('X'.repeat(500))
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    const savedCard = templateCard(page, maxName.trim())
    await expect(savedCard).toBeVisible()
    await expect
      .poll(async () =>
        (await (await context.request.get(templatesPath)).json()).find(
          (row: { id: string }) => row.id === created.id,
        ),
      )
      .toMatchObject({
        name: maxName.trim(),
        items: [
          { text: 'X'.repeat(500), ownerRole: 'newcomer', sort: 0 },
          { text: 'Instruction for buddy', ownerRole: 'buddy', sort: 1 },
          { text: 'Instruction for head', ownerRole: 'head', sort: 2 },
          { text: 'Instruction for newcomer', ownerRole: 'newcomer', sort: 3 },
        ],
      })
    await page.reload()
    await expect(savedCard.getByRole('listitem')).toHaveCount(4)
    for (const [index, role] of ['newcomer', 'buddy', 'head', 'newcomer'].entries()) {
      await expect(savedCard.getByRole('listitem').nth(index).getByRole('combobox')).toHaveValue(
        role,
      )
    }
  } finally {
    await context.close()
  }
})

test('@qa dirty checklist name survives a real peer refetch and explicit save replaces the peer name', async ({
  browser,
}) => {
  const owner = await newFlowContext(browser)
  const peer = await newFlowContext(browser)
  try {
    await colleague(owner)
    await colleague(peer)
    const created = await createTemplate(owner)
    const page = await owner.newPage()
    const peerPage = await peer.newPage()
    await page.goto('/pages?tab=onboarding')
    await peerPage.goto('/pages?tab=onboarding')
    await templateCard(page, created.name)
      .getByRole('button', { name: 'Edit checklist name', exact: true })
      .click()
    const localName = `Local name ${randomUUID()}`
    await templateCard(page, created.name)
      .getByRole('textbox', { name: 'Checklist name', exact: true })
      .fill(localName)
    await peerPage.bringToFront()
    const peerCard = templateCard(peerPage, created.name)
    await peerCard.getByRole('button', { name: 'Edit checklist name', exact: true }).click()
    const peerName = `Peer name ${randomUUID()}`
    await peerCard.getByRole('textbox', { name: 'Checklist name', exact: true }).fill(peerName)
    await peerCard.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await peer.request.get(templatesPath)).json()).find(
            (row: { id: string }) => row.id === created.id,
          ).name,
      )
      .toBe(peerName)
    await page.bringToFront()
    const refetched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === templatesPath && response.request().method() === 'GET',
    )
    await page
      .getByRole('textbox', { name: 'Checklist name', exact: true })
      .last()
      .fill(`Refresh name ${randomUUID()}`)
    await page.getByRole('button', { name: 'New checklist', exact: true }).click()
    await refetched
    const incomingCard = templateCard(page, peerName)
    await expect(
      incomingCard.getByRole('textbox', { name: 'Checklist name', exact: true }),
    ).toHaveValue(localName)
    await expect(incomingCard.getByRole('status')).toContainText('changed in another session')
    await incomingCard.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(async () =>
        (await (await owner.request.get(templatesPath)).json()).find(
          (row: { id: string }) => row.id === created.id,
        ),
      )
      .toMatchObject({ name: localName, items: [{ text: 'Original instruction' }] })
    await page.reload()
    await expect(templateCard(page, localName)).toContainText('Original instruction')
    await expect(templateCard(page, localName).getByRole('status')).toHaveCount(0)
  } finally {
    await owner.close()
    await peer.close()
  }
})

test('@qa every FAQ answer link navigates and every disclosure supports keyboard open and close', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  const admin = await newFlowContext(browser)
  try {
    await colleague(context)
    const page = await context.newPage()
    const destinations = [
      '/work/mine',
      '/work/workload',
      '/admin',
      '/work',
      '/projects',
      '/work/archive',
      '/work',
      '/account',
      '/account/telegram',
      '/ai',
    ]
    for (const [index, destination] of destinations.entries()) {
      await page.goto('/help')
      const answer = page.locator('main details').nth(index)
      const summary = answer.locator('summary')
      await summary.focus()
      await summary.press('Enter')
      await expect(answer).toHaveAttribute('open', '')
      await expect(summary).toBeFocused()
      await summary.press('Enter')
      await expect(answer).not.toHaveAttribute('open', '')
      if (destination === '/admin') continue
      await summary.press('Enter')
      await answer.getByRole('link').click()
      await expect.poll(() => new URL(page.url()).pathname).toBe(destination)
      await waitForLoadedRoute(page, destination)
      await page.goBack()
      await expect(page.locator('main details')).toHaveCount(10)
    }
    await page.locator('main').getByRole('link', { name: 'Pages', exact: true }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/pages')
    await loginAsSuperAdmin(admin)
    expect((await authedPatch(admin, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const adminPage = await admin.newPage()
    await adminPage.goto('/help')
    const adminAnswer = adminPage.locator('main details').nth(2)
    await adminAnswer.locator('summary').click()
    await adminAnswer.getByRole('link').click()
    await expect.poll(() => new URL(adminPage.url()).pathname).toBe('/admin')
    await waitForLoadedRoute(adminPage, '/admin')
  } finally {
    await context.close()
    await admin.close()
  }
})

test('@qa toolbar commands toggle off with correct pressed state and ordinary content persists', async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const page = await context.newPage()
    for (const [label, type] of [
      ['Bold', 'bold'],
      ['Italic', 'italic'],
      ['Heading 1', 'heading'],
      ['Heading 2', 'heading'],
      ['Bullet list', 'bulletList'],
      ['Numbered list', 'orderedList'],
      ['Checklist', 'taskList'],
      ['Quote', 'blockquote'],
      ['Code block', 'codeBlock'],
      ['Callout', 'callout'],
    ] as const) {
      const response = await authedPost(context, '/api/v1/pages', {
        title: `Toggle ${label} ${randomUUID()}`,
        kind: 'note',
        blocks: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordinary paragraph' }] }],
        },
      })
      const created = await response.json()
      await page.goto(`/pages?page=${created.id}`)
      const body = page.getByRole('textbox', { name: 'Page content', exact: true })
      await body.click()
      await body.press('ControlOrMeta+a')
      const command = page.getByRole('button', { name: label, exact: true })
      await expect(command).toHaveAttribute('aria-pressed', 'false')
      await command.click()
      await expect
        .poll(async () =>
          JSON.stringify(
            (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
          ),
        )
        .toContain(`"type":"${type}"`)
      await expect(page.locator('main').getByRole('status')).toContainText('Saved')
      // StarterKit adds an empty trailing paragraph and isolating callouts can expose a gap
      // cursor. Place the caret in the actual formatted text before checking its pressed state.
      await body.getByText('Ordinary paragraph', { exact: true }).click()
      await body.press('Home')
      await expect(command).toHaveAttribute('aria-pressed', 'true')
      if (label === 'Bold' || label === 'Italic') {
        // At a caret, a mark toggle only changes future typing. Its pressed state must update
        // without a document save. Select the existing text again before removing its mark.
        await command.click()
        await expect(command).toHaveAttribute('aria-pressed', 'false')
        await body.press('ControlOrMeta+a')
        await expect(command).toHaveAttribute('aria-pressed', 'true')
      }
      await command.click()
      await expect(command).toHaveAttribute('aria-pressed', 'false')
      await expect
        .poll(async () =>
          JSON.stringify(
            (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
          ),
        )
        .not.toContain(`"type":"${type}"`)
      await page.reload()
      await expect(body).toContainText('Ordinary paragraph')
      await expect(command).toHaveAttribute('aria-pressed', 'false')
    }
  } finally {
    await context.close()
  }
})

test('@qa toolbar and slash heading choices persist their distinct levels', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await colleague(context)
    const page = await context.newPage()
    for (const method of ['toolbar', 'slash'] as const) {
      for (const level of [1, 2]) {
        const response = await authedPost(context, '/api/v1/pages', {
          kind: 'note',
          title: `Heading ${method} ${level} ${randomUUID()}`,
          blocks: { type: 'doc', content: [{ type: 'paragraph' }] },
        })
        expect(response.status()).toBe(201)
        const created = await response.json()
        await page.goto(`/pages?page=${created.id}`)
        const body = page.getByRole('textbox', { name: 'Page content', exact: true })
        if (method === 'toolbar') {
          await body.click()
          await page.getByRole('button', { name: `Heading ${level}`, exact: true }).click()
        } else {
          await body.fill('/heading')
          await page
            .getByRole('listbox')
            .getByRole('option', { name: `Heading ${level}`, exact: true })
            .click()
        }
        const text = `Heading level ${level} from ${method}`
        await body.pressSequentially(text)
        await expect
          .poll(
            async () =>
              (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks
                .content[0],
          )
          .toMatchObject({
            type: 'heading',
            attrs: { level },
            content: [{ type: 'text', text }],
          })
        await page.reload()
        await expect(body.locator(`h${level}`)).toHaveText(text)
        expect(
          (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks
            .content[0].attrs.level,
        ).toBe(level)
      }
    }
  } finally {
    await context.close()
  }
})

test('@qa mention keyboard and touch selection persist while slash ignores inline and code content', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: FLOW_WEB_BASE_URL,
    extraHTTPHeaders: flowClientHeaders(),
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  })
  try {
    await colleague(context)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const response = await authedPost(context, '/api/v1/pages', {
      title: `Mention keyboard ${randomUUID()}`,
      kind: 'note',
      blocks: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    const created = await response.json()
    await page.goto(`/pages?page=${created.id}`)
    const body = page.getByRole('textbox', { name: 'Page content', exact: true })
    const replace = async (value: string) => {
      await body.click()
      await body.press('ControlOrMeta+a')
      await body.press('Backspace')
      await body.pressSequentially(value)
    }
    for (const key of ['Escape', 'Tab']) {
      await replace('@')
      await expect(page.getByRole('listbox')).toBeVisible()
      await body.press(key)
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(body).not.toHaveAttribute('aria-controls')
    }
    await replace('@')
    await body.press('ArrowDown')
    const selected = await page.getByRole('listbox').locator('[aria-selected="true"]').innerText()
    await body.press('Enter')
    await expect(body).toContainText(`@${selected}`)
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
        ),
      )
      .toContain('"type":"mention"')
    await page.reload()
    await expect(body).toContainText(`@${selected}`)
    await replace('@')
    const touchOption = page.getByRole('listbox').getByRole('option').first()
    const touchName = await touchOption.innerText()
    await touchOption.tap()
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(body).toContainText(`@${touchName}`)
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/v1/pages/${created.id}`)).json()).blocks,
        ),
      )
      .toContain(`"label":"${touchName}"`)
    await replace('An inline /heading query')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    const codeResponse = await authedPost(context, '/api/v1/pages', {
      title: `Code slash ${randomUUID()}`,
      kind: 'note',
      blocks: {
        type: 'doc',
        content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'Code sample ' }] }],
      },
    })
    const code = await codeResponse.json()
    await page.goto(`/pages?page=${code.id}`)
    await body.locator('code').click()
    await body.press('End')
    await body.pressSequentially('/heading')
    await expect(body.locator('pre')).toContainText('Code sample /heading')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
