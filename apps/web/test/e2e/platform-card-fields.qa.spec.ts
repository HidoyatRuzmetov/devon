import { expect, test, type Browser } from '@playwright/test'
/* eslint-disable no-restricted-syntax -- Independent read-refusal cases share one fixture definition. */
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

async function fixture(browser: Browser) {
  const context = await newFlowContext(browser)
  const admin = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('card.fields.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic inline field recovery',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const me = await (await context.request.get('/api/v1/me')).json()
    const created = await authedPost(context, '/api/v1/cards', {
      title: 'Synthetic inline field card',
      assigneeUserId: me.user.id,
    })
    expect(created.status()).toBe(201)
    const cardId = (await created.json()).id as string
    const definition = await authedPost(context, '/api/v1/fields/defs', {
      appliesTo: 'card',
      key: 'synthetic_review_note',
      label: { en: 'Synthetic review note' },
      type: 'text',
    })
    expect(definition.status()).toBe(201)
    const defId = (await definition.json()).def.id as string
    const read = async () =>
      (
        await (
          await context.request.get(`/api/v1/fields/values?subjectType=card&subjectIds=${cardId}`)
        ).json()
      ).values.find((value: { defId: string }) => value.defId === defId)?.value ?? null
    return { context, cardId, read }
  } catch (error) {
    await context.close()
    throw error
  } finally {
    await admin.close()
  }
}

for (const [resource, path] of [
  ['definition', '**/api/v1/fields/defs?appliesTo=card'],
  ['value', '**/api/v1/fields/values?*'],
]) {
  test(`@qa refused card-field ${resource} reads recover through the visible Retry action`, async ({
    browser,
  }) => {
    const f = await fixture(browser)
    try {
      const page = await f.context.newPage()
      await page.route(path!, async (route) =>
        route.fulfill({ status: 503, json: { code: 'maintenance' } }),
      )
      await page.goto(`/work?card=${f.cardId}`)
      const dialog = page.getByRole('dialog')
      const retry = dialog.getByRole('button', { name: 'Try again', exact: true })
      await expect(retry).toBeVisible()
      expect(await f.read()).toBeNull()
      await page.unroute(path!)
      const recovered = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname ===
            `/api/v1/fields/${resource === 'definition' ? 'defs' : 'values'}`,
      )
      await retry.click()
      expect((await recovered).status()).toBe(200)
      await expect(
        dialog.getByRole('button', { name: 'Edit “Synthetic review note”', exact: true }),
      ).toBeVisible()
      await expect(retry).toHaveCount(0)
      expect(await f.read()).toBeNull()
    } finally {
      await f.context.close()
    }
  })
}

test('@qa refused inline card-field saves retain the editor and retry the same draft', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const page = await f.context.newPage()
    await page.goto(`/work?card=${f.cardId}`)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Edit “Synthetic review note”', exact: true }).click()
    // The inline editor has a stable definition-derived id, unlike the card's title/description.
    const input = dialog.locator('input[id^="card-field-"]')
    await expect(input).toHaveCount(1)
    await input.fill('Synthetic refused draft')
    await page.route('**/api/v1/fields/values', async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({ status: 503, json: { code: 'maintenance' } })
      else await route.continue()
    })
    const refusal = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === '/api/v1/fields/values',
    )
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    expect((await refusal).status()).toBe(503)
    await expect(page.getByText('The field could not be saved.', { exact: true })).toBeVisible()
    expect(await f.read()).toBeNull()
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('Synthetic refused draft')
    await page.unroute('**/api/v1/fields/values')
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === '/api/v1/fields/values',
    )
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    expect((await saved).status()).toBe(204)
    expect(await f.read()).toBe('Synthetic refused draft')
    await expect(input).toHaveCount(0)
    await page.reload()
    await expect(
      dialog.getByRole('button', { name: 'Edit “Synthetic review note”', exact: true }),
    ).toHaveText('Synthetic refused draft')
  } finally {
    await f.context.close()
  }
})

test('@qa inline card-field text editors are named by the visible field label', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const page = await f.context.newPage()
    await page.goto(`/work?card=${f.cardId}`)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Edit “Synthetic review note”', exact: true }).click()
    const input = dialog.locator('input[id^="card-field-"]')
    await dialog.screenshot({ path: test.info().outputPath('inline-field-label.png') })
    await expect(input).toHaveAccessibleName('Synthetic review note')
  } finally {
    await f.context.close()
  }
})

test('@qa a held inline card-field save preserves a reopened later draft for a second save', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release: (() => void) | undefined
  try {
    const page = await f.context.newPage()
    await page.goto(`/work?card=${f.cardId}`)
    const dialog = page.getByRole('dialog')
    const edit = dialog.getByRole('button', { name: 'Edit “Synthetic review note”', exact: true })
    const input = dialog.locator('input[id^="card-field-"]')
    let acknowledge: (() => void) | undefined
    const committed = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    await page.route('**/api/v1/fields/values', async (route) => {
      if (route.request().method() !== 'PUT' || !first) return route.continue()
      first = false
      const response = await route.fetch()
      expect(response.status()).toBe(204)
      acknowledge!()
      await held
      await route.fulfill({ response })
    })
    await edit.click()
    await input.fill('Synthetic first saved note')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await committed
    expect(await f.read()).toBe('Synthetic first saved note')
    // Cancel is valid whether the older implementation closed immediately or the repaired
    // editor stays open until acknowledgement. Reopen through the real row action.
    if (await input.count())
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await edit.click()
    await input.fill('Synthetic later reopened note')
    const receipt = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === '/api/v1/fields/values',
    )
    release!()
    expect((await receipt).status()).toBe(204)
    await expect(page.getByText('Field updated.', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled()
    await expect(input).toHaveValue('Synthetic later reopened note')
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === '/api/v1/fields/values',
    )
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    expect((await saved).status()).toBe(204)
    expect(await f.read()).toBe('Synthetic later reopened note')
  } finally {
    release?.()
    await f.context.close()
  }
})
