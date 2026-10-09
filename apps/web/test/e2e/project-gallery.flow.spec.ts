import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { settleCapture } from './platform-capture.js'

test('@flow gallery project creation cannot leave a partial project on refusal', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('gallery.head'),
      headPassword: examplePassword(),
      departmentName: 'Local gallery check',
    })
    expect(
      (
        await head.request.put(`/api/v1/departments/${department.departmentId}/features`, {
          headers: { 'x-csrf-token': await csrfToken(head) },
          data: { features: { templates: true } },
        })
      ).status(),
    ).toBe(200)
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const template = await authedPost(head, '/api/v1/work/templates', {
      name: 'Local gallery starter',
      kind: 'project',
      scope: 'department',
      payload: {
        title: 'Project from gallery',
        cards: [{ title: 'First shared task' }, { title: 'Second shared task' }],
      },
    })
    expect(template.status()).toBe(201)
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('gallery.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    {
      const cardTemplate = await authedPost(head, '/api/v1/work/templates', {
        name: 'Shared card starter',
        kind: 'card',
        scope: 'department',
        payload: { title: 'Shared template count check' },
      })
      expect(cardTemplate.status()).toBe(201)
      const cardTemplateId = ((await cardTemplate.json()) as { id: string }).id
      const used = await authedPost(
        member,
        `/api/v1/work/templates/${cardTemplateId}/create-card`,
        {},
      )
      expect(used.status()).toBe(201)
      const templates = (await (await head.request.get('/api/v1/work/templates')).json()) as {
        id: string
        useCount: number
      }[]
      const actual = templates.find((item) => item.id === cardTemplateId)
      expect(actual?.useCount).toBe(1)
    }
    const page = await head.newPage()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/projects')
    await page.getByRole('button', { name: 'New project', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a group project' })
    await dialog.getByRole('button', { name: 'From the template gallery', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: /^Template/ })).toHaveValue(
      ((await template.json()) as { id: string }).id,
    )
    await dialog.getByLabel('Title', { exact: true }).fill('Gallery failure draft')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const reached = new Promise<void>((resolve) => {
      started = resolve
    })
    // Baseline used separate card writes; the corrected UI makes exactly one atomic project call.
    const intercept =
      process.env['PROJECT_GALLERY_BASELINE'] === 'true'
        ? '**/api/v1/cards'
        : '**/api/v1/projects/from-gallery'
    await page.route(intercept, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      started()
      await gate
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'service_unavailable',
          status: 503,
          title: 'Synthetic refusal',
        }),
      })
    })
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await reached
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
      'nested',
    )
    await mkdir(root, { recursive: true })
    const phase = process.env['PROJECT_GALLERY_BASELINE'] === 'true' ? 'before' : 'after'
    await settleCapture(page, false)
    await page.screenshot({ path: join(root, `${phase}-gallery-pending.png`) })
    await expect.soft(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await expect.soft(dialog.getByLabel('Title', { exact: true })).toBeDisabled()
    release()
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
    await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Gallery failure draft')
    const projects = (await (await head.request.get('/api/v1/projects')).json()) as {
      title: string
    }[]
    await writeFile(join(root, `${phase}-gallery-refusal.json`), JSON.stringify(projects, null, 2))
    expect(projects).toEqual([])
    await page.unroute(intercept)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const successful = (await (await head.request.get('/api/v1/projects')).json()) as {
      title: string
      objectiveTotal: number
    }[]
    expect(successful).toHaveLength(1)
    expect(successful[0]).toMatchObject({ title: 'Gallery failure draft', objectiveTotal: 2 })
  } finally {
    await head.close()
    await member.close()
    await admin.close()
  }
})
