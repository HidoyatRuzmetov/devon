/* eslint-disable no-restricted-syntax -- Option and held-response transitions are sequential. */
import { expect, test, type Browser } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  csrfToken,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { settleCapture } from './platform-capture.js'

async function fixture(browser: Browser) {
  const context = await newFlowContext(browser)
  const admin = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('fields.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic field boundaries',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    return context
  } catch (error) {
    await context.close()
    throw error
  } finally {
    await admin.close()
  }
}

test('@qa distinct punctuation-heavy field options retain separate saved answers', async ({
  browser,
}) => {
  const context = await fixture(browser)
  try {
    const page = await context.newPage()
    await page.goto('/fields')
    await page.getByRole('button', { name: 'New field', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New field', exact: true })
    await dialog
      .getByRole('textbox', { name: 'English', exact: true })
      .fill('Synthetic programming tool')
    await dialog.getByRole('combobox', { name: 'Type', exact: true }).selectOption('select')
    for (const [index, name] of ['C++', 'C#'].entries()) {
      await dialog.getByRole('button', { name: 'Add an option', exact: true }).click()
      await dialog
        .getByRole('textbox', { name: `Name of option ${index + 1}`, exact: true })
        .fill(name)
    }
    await dialog.screenshot({ path: test.info().outputPath('distinct-options-draft.png') })
    const receipt = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/fields/defs',
    )
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    expect((await receipt).status()).toBe(201)
    const stored = (await (await context.request.get('/api/v1/fields/defs')).json()).defs[0]
    expect(stored.options.map((option: { label: { en: string } }) => option.label.en)).toEqual([
      'C++',
      'C#',
    ])
    const ids = stored.options.map((option: { id: string }) => option.id)
    await test.info().attach('synthetic-option-identities', {
      body: JSON.stringify(ids),
      contentType: 'application/json',
    })
    expect(new Set(ids).size, 'Distinct saved options must have distinct answer identities').toBe(2)
    await page.goto('/account#fields')
    const section = page.locator('#fields')
    const answer = section.getByRole('combobox', {
      name: 'Synthetic programming tool',
      exact: true,
    })
    await answer.selectOption({ label: 'C#' })
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === '/api/v1/fields/me',
    )
    await section.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    const persisted = (await (await context.request.get('/api/v1/fields/me')).json()).fields[0]
    expect(persisted.value).toBe(ids[1])
    await page.reload()
    await expect(answer).toHaveValue(ids[1])
    expect(await answer.locator('option:checked').textContent()).toBe('C#')
  } finally {
    await context.close()
  }
})

test('@qa duplicate option references are refused on create and edit without changing saved options', async ({
  browser,
}) => {
  const context = await fixture(browser)
  try {
    const options = ['alpha', 'beta'].map((id, order) => ({
      id,
      label: { en: `Synthetic ${id}` },
      colorToken: 'blue',
      order,
    }))
    const duplicate = options.map((option) => ({ ...option, id: 'same_reference' }))
    const body = {
      appliesTo: 'person',
      key: 'synthetic_option_boundary',
      label: { en: 'Synthetic option boundary' },
      type: 'select',
      options: duplicate,
    }
    const refusedCreate = await authedPost(context, '/api/v1/fields/defs', body)
    expect(refusedCreate.status()).toBe(422)
    expect((await refusedCreate.json()).errors).toEqual([
      { path: 'options', code: 'duplicate_option' },
    ])
    expect((await (await context.request.get('/api/v1/fields/defs')).json()).defs).toEqual([])
    const accepted = await authedPost(context, '/api/v1/fields/defs', { ...body, options })
    expect(accepted.status()).toBe(201)
    const saved = (await accepted.json()).def
    const refusedEdit = await authedPatch(context, `/api/v1/fields/defs/${saved.id}`, {
      options: duplicate,
    })
    expect(refusedEdit.status()).toBe(422)
    expect((await refusedEdit.json()).errors).toEqual([
      { path: 'options', code: 'duplicate_option' },
    ])
    const persisted = (await (await context.request.get('/api/v1/fields/defs')).json()).defs[0]
    expect(persisted.options).toEqual(options)
  } finally {
    await context.close()
  }
})

test('@qa the local API refuses impossible field dates and preserves real leap days', async ({
  browser,
}) => {
  const context = await fixture(browser)
  try {
    const accepted = await authedPost(context, '/api/v1/fields/defs', {
      appliesTo: 'person',
      key: 'synthetic_review_day',
      label: { en: 'Synthetic review day' },
      type: 'date',
    })
    expect(accepted.status()).toBe(201)
    const saved = (await accepted.json()).def
    const headers = { 'x-csrf-token': await csrfToken(context) }
    const refused = await context.request.put('/api/v1/fields/me', {
      headers,
      data: { items: [{ defId: saved.id, value: '2026-02-31' }] },
    })
    expect(refused.status()).toBe(422)
    // The API deliberately uses its existing domain-level refusal; the shared form validator
    // has the more specific not_a_date copy. Do not change that wire contract to satisfy a test.
    expect((await refused.json()).errors[0].code).toBe('invalid_value')
    expect(
      (await (await context.request.get('/api/v1/fields/me')).json()).fields[0].value,
    ).toBeNull()
    const leapDay = await context.request.put('/api/v1/fields/me', {
      headers,
      data: { items: [{ defId: saved.id, value: '2024-02-29' }] },
    })
    expect(leapDay.status()).toBe(200)
    expect((await (await context.request.get('/api/v1/fields/me')).json()).fields[0].value).toBe(
      '2024-02-29',
    )
  } finally {
    await context.close()
  }
})

test('@qa active fields can be moved past archived rows without mutating the wrong definition', async ({
  browser,
}) => {
  const context = await fixture(browser)
  try {
    const ids: string[] = []
    for (const key of ['alpha', 'beta', 'gamma']) {
      const created = await authedPost(context, '/api/v1/fields/defs', {
        appliesTo: 'person',
        key: `synthetic_${key}_order`,
        label: { en: `Synthetic ${key} order` },
        type: 'text',
      })
      expect(created.status()).toBe(201)
      ids.push((await created.json()).def.id)
    }
    const page = await context.newPage()
    await page.goto('/fields')
    const row = (key: string) =>
      page.locator('article').filter({
        has: page.getByRole('heading', { name: new RegExp(`^Synthetic ${key} order`) }),
      })
    const archived = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/fields/defs/${ids[1]}/archive`,
    )
    await row('beta').getByRole('button', { name: 'Archive', exact: true }).click()
    expect((await archived).status()).toBe(200)
    const archiveToggle = page.getByRole('switch', { name: 'Show archived', exact: true })
    await archiveToggle.click()
    await expect(archiveToggle).toHaveAttribute('aria-checked', 'true')
    await expect(row('beta').getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
    const moved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/fields/defs/reorder',
    )
    await row('gamma').getByRole('button', { name: 'Move up', exact: true }).click()
    const receipt = await moved
    expect(receipt.status()).toBe(204)
    expect(receipt.request().postDataJSON()).toEqual({ ids: [ids[2], ids[0]] })
    const persisted = (await (await context.request.get('/api/v1/fields/defs')).json()).defs
      .filter((def: { archivedAt: string | null }) => def.archivedAt === null)
      .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
    expect(persisted.map((def: { id: string }) => def.id)).toEqual([ids[2], ids[0]])
    await page.reload()
    await expect(row('gamma').getByRole('button', { name: 'Move up', exact: true })).toBeDisabled()
    await expect(
      row('alpha').getByRole('button', { name: 'Move down', exact: true }),
    ).toBeDisabled()
  } finally {
    await context.close()
  }
})

test('@qa all nine editable field types can be created and answered with persisted values', async ({
  browser,
}) => {
  const context = await fixture(browser)
  try {
    const page = await context.newPage()
    const types = [
      'text',
      'long_text',
      'number',
      'date',
      'select',
      'multi_select',
      'person',
      'url',
      'checkbox',
    ] as const
    await page.goto('/fields')
    for (const type of types) {
      await page.getByRole('button', { name: 'New field', exact: true }).first().click()
      const dialog = page.getByRole('dialog', { name: 'New field', exact: true })
      await dialog
        .getByRole('textbox', { name: 'English', exact: true })
        .fill(`Synthetic ${type} answer`)
      await dialog.getByRole('combobox', { name: 'Type', exact: true }).selectOption(type)
      if (type === 'select' || type === 'multi_select') {
        for (const [index, option] of ['Synthetic alpha', 'Synthetic beta'].entries()) {
          await dialog.getByRole('button', { name: 'Add an option', exact: true }).click()
          await dialog
            .getByRole('textbox', { name: `Name of option ${index + 1}`, exact: true })
            .fill(option)
        }
      }
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/fields/defs',
      )
      await dialog.getByRole('button', { name: 'Add', exact: true }).click()
      expect((await saved).status()).toBe(201)
      await expect(dialog).toBeHidden()
    }
    const defs = (await (await context.request.get('/api/v1/fields/defs')).json()).defs
    expect(defs).toHaveLength(9)
    expect(defs.map((def: { type: string }) => def.type)).toEqual(types)
    await page.goto('/account#fields')
    const section = page.locator('#fields')
    await section
      .getByRole('textbox', { name: 'Synthetic text answer', exact: true })
      .fill("Qo‘llanma O'Connor")
    await section
      .getByRole('textbox', { name: 'Synthetic long_text answer', exact: true })
      .fill('Synthetic first line\nSynthetic second line')
    await section
      .getByRole('spinbutton', { name: 'Synthetic number answer', exact: true })
      .fill('0')
    await section
      .getByRole('textbox', { name: 'Synthetic person answer', exact: true })
      .fill('Synthetic reviewer')
    await section
      .getByRole('textbox', { name: 'Synthetic url answer', exact: true })
      .fill('https://example.test/synthetic?q=1')
    await section
      .getByRole('combobox', { name: 'Synthetic select answer', exact: true })
      .selectOption({ label: 'Synthetic beta' })
    const multiple = section.getByRole('group', {
      name: 'Synthetic multi_select answer',
      exact: true,
    })
    await multiple.getByRole('button', { name: 'Synthetic alpha', exact: true }).click()
    await multiple.getByRole('button', { name: 'Synthetic beta', exact: true }).click()
    await multiple.getByRole('button', { name: 'Synthetic alpha', exact: true }).click()
    const checkbox = section.getByRole('checkbox', { name: /^Synthetic checkbox answer/ })
    await expect(checkbox).toHaveAccessibleName('Synthetic checkbox answer')
    await expect(section.getByText('Synthetic checkbox answer', { exact: true })).toHaveCount(1)
    await checkbox.click()
    await checkbox.click()
    await section.getByRole('button', { name: 'Synthetic date answer', exact: true }).click()
    const day = await page.evaluate(() => {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
    })
    await page.locator(`[data-day="${day}"] button`).click()
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === '/api/v1/fields/me',
    )
    await section.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(200)
    const expected: Record<string, unknown> = {
      text: "Qo‘llanma O'Connor",
      long_text: 'Synthetic first line\nSynthetic second line',
      number: 0,
      person: 'Synthetic reviewer',
      url: 'https://example.test/synthetic?q=1',
      date: day,
      checkbox: false,
      select: defs.find((def: { type: string }) => def.type === 'select').options[1].id,
      multi_select: [
        defs.find((def: { type: string }) => def.type === 'multi_select').options[1].id,
      ],
    }
    const stored = (await (await context.request.get('/api/v1/fields/me')).json()).fields
    for (const field of stored) expect(field.value).toEqual(expected[field.def.type])
    await page.reload()
    await expect(
      section.getByRole('spinbutton', { name: 'Synthetic number answer', exact: true }),
    ).toHaveValue('0')
    await expect(
      section.getByRole('textbox', { name: 'Synthetic long_text answer', exact: true }),
    ).toHaveValue(expected['long_text'] as string)
    await expect(checkbox).not.toBeChecked()
    await expect(
      multiple.getByRole('button', { name: 'Synthetic beta', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    // A tall element screenshot can place the sticky header across the element's middle.
    // Preserve an actual settled full-page composition instead of mistaking that stitch for UI.
    await settleCapture(page)
    await page.screenshot({
      path: test.info().outputPath('all-editable-answers-page.png'),
      fullPage: true,
    })
  } finally {
    await context.close()
  }
})

test('@qa a held field create cannot close a later definition draft', async ({ browser }) => {
  const context = await fixture(browser)
  let release: (() => void) | undefined
  try {
    const page = await context.newPage()
    let acknowledge: (() => void) | undefined
    const committed = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/fields/defs', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      acknowledge!()
      await held
      await route.fulfill({ response })
    })
    await page.goto('/fields')
    await page.getByRole('button', { name: 'New field', exact: true }).first().click()
    let dialog = page.getByRole('dialog', { name: 'New field', exact: true })
    await dialog
      .getByRole('textbox', { name: 'English', exact: true })
      .fill('Synthetic accepted field')
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await committed
    expect((await (await context.request.get('/api/v1/fields/defs')).json()).defs).toHaveLength(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'New field', exact: true }).first().click()
    dialog = page.getByRole('dialog', { name: 'New field', exact: true })
    await dialog
      .getByRole('textbox', { name: 'English', exact: true })
      .fill('Synthetic later field draft')
    const receipt = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/fields/defs',
    )
    const refreshed = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/v1/fields/defs',
    )
    release!()
    expect((await receipt).status()).toBe(201)
    expect((await refreshed).status()).toBe(200)
    // A network receipt/refetch may precede the mutation callback. Its actual success feedback
    // establishes that the earlier save's callback ran before checking the later dialog.
    await expect(
      page.getByText('“Synthetic accepted field” was added.', { exact: true }),
    ).toBeVisible()
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    // A fading-out Radix dialog remains technically visible during its exit animation.
    await expect(dialog).toHaveAttribute('data-state', 'open')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'English', exact: true })).toHaveValue(
      'Synthetic later field draft',
    )
    await dialog.screenshot({ path: test.info().outputPath('later-definition-draft.png') })
  } finally {
    release?.()
    await context.close()
  }
})
