import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow page reading, Markdown editing, safe HTML downloads and comment revisions', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('page.revisions'),
      headPassword: examplePassword(),
      departmentName: 'Page reading QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/pages', {
      title: 'Center-wide phonebook',
      blocks: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Download the directory below.' }] },
        ],
      },
    })
    expect(response.status()).toBe(201)
    const created = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.goto(`/pages?page=${created.id}`)
    await expect(
      page.getByRole('heading', { name: 'Center-wide phonebook', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit page', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Center-wide phonebook',
    )
    await page.getByRole('button', { name: 'Write Markdown', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Write Markdown', exact: true })
      .fill(
        '\n## Using the directory\n\n**Search by name** or unit.\n\n- Download the attached file.\n- Open it on your computer.',
      )
    await page.getByRole('button', { name: 'Insert formatted text', exact: true }).click()
    await expect(page.locator('main .tiptap h2')).toHaveText('Using the directory')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'phonebook.html',
      mimeType: 'text/html',
      buffer: Buffer.from(
        '<!doctype html><title>Phonebook</title><h1>Directory</h1><script>throw new Error("must never run")</script>',
      ),
    })
    const download = page.getByRole('link', { name: 'phonebook.html', exact: true })
    await expect(download).toBeVisible()
    await page.getByRole('button', { name: 'Done editing', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit page', exact: true })).toBeVisible()
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
    await expect(download).toBeVisible()
    const href = await download.getAttribute('href')
    expect(href).toBeTruthy()
    const file = await context.request.get(href!)
    expect(file.status()).toBe(200)
    expect(file.headers()['content-disposition']).toContain('attachment')
    expect(file.headers()['x-content-type-options']).toBe('nosniff')
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Using the directory', exact: true }),
    ).toBeVisible()
    await expect(page.locator('main .tiptap strong')).toHaveText('Search by name')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('page-read-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: testInfo.outputPath('page-read-desktop.png'), fullPage: true })

    const me = (await (await context.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const cardResponse = await authedPost(context, '/api/v1/cards', {
      title: 'Comment editing QA',
      assigneeUserId: me.user.id,
    })
    expect(cardResponse.status()).toBe(201)
    const card = (await cardResponse.json()) as { id: string }
    const commentResponse = await authedPost(context, `/api/v1/cards/${card.id}/comments`, {
      text: 'Original comment',
      mentions: [],
    })
    const comment = (await commentResponse.json()) as { id: string }
    await page.goto(`/work/card?id=${card.id}`)
    const row = page.locator(`#comment-${comment.id}`)
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.scrollIntoViewIfNeeded()
    await row.getByRole('button', { name: 'Edit comment', exact: true }).click({ timeout: 10000 })
    await row.getByRole('textbox').fill('Corrected comment')
    await row.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(row.getByText('Corrected comment', { exact: true })).toBeVisible()
    await expect(row.getByText('Edited', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    await row.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await expect(row).toHaveCount(0)
  } finally {
    await context.close()
    await admin.close()
  }
})

test('@flow a finished event has wrapping tabs and preserves editable discussion', async ({
  browser,
}, testInfo) => {
  test.setTimeout(75_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('event.readonly'),
      headPassword: examplePassword(),
      departmentName: 'Event read-only QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const response = await authedPost(context, '/api/v1/events', {
      title: 'Finished workshop',
      startsAt: new Date(Date.now() - 7200000).toISOString(),
      endsAt: new Date(Date.now() - 3600000).toISOString(),
    })
    expect(response.status()).toBe(201)
    const event = (await response.json()) as { id: string }
    const page = await context.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/events?event=${event.id}`)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/This event has ended or closed/)).toBeVisible()
    expect(
      await dialog.getByRole('tablist').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await expect(dialog.locator('fieldset').first()).toHaveAttribute('disabled', '')
    await dialog.getByRole('tab', { name: 'Discussion', exact: true }).click()
    await dialog.getByRole('textbox').fill('Useful retrospective')
    await dialog.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(dialog.getByText('Useful retrospective', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Edit comment', exact: true }).click()
    await dialog
      .getByRole('textbox', { name: 'Edit comment', exact: true })
      .fill('Corrected retrospective')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog.getByText('Corrected retrospective', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Edited', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Edit comment', exact: true })).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('event-discussion-mobile.png'),
      fullPage: true,
    })
  } finally {
    await context.close()
    await admin.close()
  }
})
