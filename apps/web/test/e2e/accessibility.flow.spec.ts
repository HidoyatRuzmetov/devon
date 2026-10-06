import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { FEATURE_KEYS } from '@devon/contracts'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
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

// Keep the original route inventory covered, but render real authenticated records instead of
// scanning login redirects or missing-ID error screens and reporting those as successful coverage.
const inventory = JSON.parse(
  readFileSync(new URL('../../../../e2e/routes.json', import.meta.url), 'utf8'),
) as { routes: { path: string; auth: string }[] }

async function inspect(page: Page, path: string, info: TestInfo) {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main')).toBeVisible()
  await expect
    .soft(
      page.getByRole('heading', { name: /^(Could not load the data|Yuklab boʻlmadi)$/ }),
      `${path}: data must load`,
    )
    .toHaveCount(0)
  expect
    .soft(new URL(page.url()).pathname, `route ${path} must render, not redirect`)
    .toBe(path.split('?')[0])
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const violations = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  if (violations.length) {
    await info.attach(`axe-${path.replace(/[^a-z0-9]/gi, '-')}`, {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    })
  }
  expect.soft(violations, `${path}: serious/critical accessibility violations`).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.soft(page.locator('main'), `${path}: mobile content`).toBeVisible()
  expect
    .soft(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${path}: page must fit a 390px viewport (wide tables may scroll inside their container)`,
    )
    .toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
}

for (const role of ['head', 'member'] as const) {
  test(`@a11y @flow ${role}: all workplace routes, real details, and admin restriction`, async ({
    browser,
  }, info) => {
    test.setTimeout(360_000)
    const admin = await newFlowContext(browser)
    const head = await newFlowContext(browser)
    const member = await newFlowContext(browser)
    try {
      await loginAsSuperAdmin(admin)
      const department = await createApprovedDepartment(head, admin, {
        headLogin: uniqueLogin('axe.head'),
        headPassword: examplePassword(),
        departmentName: uniqueLogin('Accessible department'),
      })
      // New departments deliberately start with advanced features off. Enable them through the
      // real head-only settings API so the sweep checks their working screens, not disabled states.
      expect(
        (
          await head.request.put(`/api/v1/departments/${department.departmentId}/features`, {
            headers: { 'x-csrf-token': await csrfToken(head) },
            data: { features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) },
          })
        ).status(),
      ).toBe(200)
      await joinDepartmentAsNewUser(member, {
        login: uniqueLogin('axe.member'),
        password: examplePassword(),
        joinKey: department.joinKey,
        joinPassword: department.joinPassword,
      })
      const context = role === 'head' ? head : member
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      const me = (await (await context.request.get('/api/v1/me')).json()) as {
        user: { id: string }
      }
      const templates = (await (await head.request.get('/api/v1/projects/templates')).json()) as {
        key: string
      }[]
      const projectRes = await authedPost(head, '/api/v1/projects/from-template', {
        templateKey: templates[0]!.key,
        title: 'Accessible group project',
        ownerUserId: me.user.id,
        members: [me.user.id],
      })
      expect(projectRes.status()).toBe(201)
      const project = (await projectRes.json()) as { id: string }
      const cardRes = await authedPost(context, '/api/v1/cards', {
        title: 'Accessible task details',
        assigneeUserId: me.user.id,
        projectId: project.id,
        projectScope: 'objective',
      })
      expect(cardRes.status()).toBe(201)
      const card = (await cardRes.json()) as { id: string }
      const page = await context.newPage()
      const paths = inventory.routes.filter((r) => r.auth === 'session').map((r) => r.path)
      paths.push('/help')
      for (const path of paths) {
        const resolved =
          path === '/projects/view'
            ? `${path}?id=${project.id}`
            : path === '/work/card'
              ? `${path}?id=${card.id}`
              : path
        // Routes share one browser page; navigation and inspection must be sequential.
        // eslint-disable-next-line no-restricted-syntax
        await test.step(resolved, () => inspect(page, resolved, info))
      }
      await page.goto('/admin')
      await expect(
        page.getByRole('heading', { name: 'This page is not open to you' }),
      ).toBeVisible()
      expect((await context.request.get('/api/v1/admin/accounts')).status()).toBe(403)
    } finally {
      await Promise.all([admin.close(), head.close(), member.close()])
    }
  })
}

test('@a11y @flow superadmin: all administration routes', async ({ browser }, info) => {
  test.setTimeout(180_000)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(context)
    // This bootstrap account is shared with the admin-console flow. Inspect its default Uzbek
    // interface without changing a persisted preference while another test is using the account.
    const page = await context.newPage()
    for (const route of inventory.routes.filter((r) => r.auth === 'super_admin')) {
      // Routes share one browser page; navigation and inspection must be sequential.
      // eslint-disable-next-line no-restricted-syntax
      await test.step(route.path, () => inspect(page, route.path, info))
    }
  } finally {
    await context.close()
  }
})

test('@a11y @flow public: entry points and unauthenticated restrictions', async ({
  browser,
}, info) => {
  test.setTimeout(120_000)
  const context = await newFlowContext(browser)
  try {
    const page = await context.newPage()
    for (const route of inventory.routes.filter((r) => r.auth === 'public')) {
      // Routes share one browser page; navigation and inspection must be sequential.
      // eslint-disable-next-line no-restricted-syntax
      await test.step(route.path, () => inspect(page, route.path, info))
    }
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/)
    expect((await context.request.get('/api/v1/admin/accounts')).status()).toBe(401)
  } finally {
    await context.close()
  }
})
