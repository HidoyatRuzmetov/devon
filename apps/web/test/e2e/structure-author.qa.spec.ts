import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'

type Unit = {
  id: string
  name: string
  parentUnitId: string | null
  colour: number | null
  path: string
}
type Role = { id: string; userId: string; unitId: string; role: string }
type Member = { userId: string; membershipRole: string; unitId: string | null }

async function fixture(browser: Browser) {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  const external: string[] = []
  await Promise.all(
    [admin, head, member].map((context) =>
      context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === FLOW_WEB_BASE_URL) return route.continue()
        external.push(new URL(route.request().url()).hostname)
        return route.abort('blockedbyclient')
      }),
    ),
  )
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('structure.head'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic authoring department',
  })
  await joinDepartmentAsNewUser(member, {
    login: uniqueLogin('structure.member'),
    password: examplePassword(),
    joinKey: department.joinKey,
    joinPassword: department.joinPassword,
  })
  await Promise.all(
    [head, member].map(async (context, index) => {
      expect(
        (
          await authedPatch(context, '/api/v1/accounts/profile', {
            givenName: index === 0 ? 'Head' : 'Member',
            familyName: 'Author',
          })
        ).status(),
      ).toBe(200)
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    }),
  )
  const headId = (await (await head.request.get('/api/v1/me')).json()).user.id as string
  const memberId = (await (await member.request.get('/api/v1/me')).json()).user.id as string
  const prefix = `/api/v1/departments/${department.departmentId}`
  const page = await head.newPage()
  await page.setViewportSize({ width: 1366, height: 900 })
  const units = async (): Promise<Unit[]> => {
    const response = await head.request.get(`${prefix}/units`)
    expect(response.status()).toBe(200)
    return (await response.json()).units as Unit[]
  }
  const roles = async (): Promise<Role[]> => {
    const response = await head.request.get(`${prefix}/unit-roles`)
    expect(response.status()).toBe(200)
    return response.json() as Promise<Role[]>
  }
  const roster = async (): Promise<Member[]> => {
    const response = await head.request.get(`${prefix}/roster`)
    expect(response.status()).toBe(200)
    return response.json() as Promise<Member[]>
  }
  return {
    head,
    member,
    page,
    prefix,
    headId,
    memberId,
    units,
    roles,
    roster,
    close: async () => {
      await Promise.all([head.close(), member.close(), admin.close()])
      expect(external).toEqual([])
    },
  }
}

function row(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Structure', exact: true })
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
}

async function action(page: Page, name: string, command: string) {
  await row(page, name).getByRole('button', { name: 'Unit actions', exact: true }).click()
  await page.getByRole('menuitem', { name: command, exact: true }).click()
}

async function add(page: Page, name: string, parent?: string) {
  if (parent) await action(page, parent, 'Add a sub-unit')
  else
    await page
      .locator('header')
      .filter({ has: page.getByRole('heading', { name: 'Structure', exact: true }) })
      .getByRole('button', { name: 'Add a unit', exact: true })
      .click()
  const dialog = page.getByRole('dialog', { name: 'New unit', exact: true })
  await expect(dialog).toHaveAttribute('data-state', 'open')
  await dialog.getByRole('textbox', { name: /^Unit name\b/ }).fill(name)
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/units'),
  )
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const response = await saved
  expect(response.status()).toBe(201)
  await expect(row(page, name)).toBeVisible()
  return (await response.json()) as Unit
}

test('head authors units, assigns and removes a member, restores the deleted subtree and retains management scope', async ({
  browser,
}, info) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/structure')
    const root = await add(f.page, 'Delivery team')
    await action(f.page, root.name, 'Rename')
    const nameInput = f.page
      .getByRole('list', { name: 'Structure', exact: true })
      .getByRole('textbox')
    await nameInput.fill('Delivery office')
    const renamed = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith(`/units/${root.id}`),
    )
    await nameInput.press('Enter')
    expect((await renamed).status()).toBe(200)
    await expect(row(f.page, 'Delivery office')).toBeVisible()
    expect((await f.units()).find((unit) => unit.id === root.id)?.name).toBe('Delivery office')
    const child = await add(f.page, 'Support desk', 'Delivery office')
    expect(child.parentUnitId).toBe(root.id)
    expect((await f.units()).find((unit) => unit.id === child.id)?.path).toContain(
      `${root.id}/${child.id}/`,
    )
    await row(f.page, 'Delivery office').getByRole('button', { name: 'Collapse sub-units' }).click()
    await expect(row(f.page, 'Support desk')).not.toBeVisible()
    await row(f.page, 'Delivery office').getByRole('button', { name: 'Expand sub-units' }).click()
    await expect(row(f.page, 'Support desk')).toBeVisible()
    await action(f.page, 'Support desk', 'Assign')
    const assignment = f.page.getByRole('dialog', { name: 'Assign to “Support desk”', exact: true })
    await assignment.getByRole('combobox', { name: 'Person', exact: true }).click()
    await f.page.getByRole('option', { name: 'Member Author', exact: true }).click()
    await assignment.getByRole('radio', { name: 'Deputy', exact: true }).check()
    const assigned = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/unit-roles'),
    )
    await assignment.getByRole('button', { name: 'Assign', exact: true }).click()
    expect((await assigned).status()).toBe(201)
    expect((await f.roles()).map((role) => [role.unitId, role.userId, role.role])).toEqual([
      [child.id, f.memberId, 'deputy'],
    ])
    expect((await f.roster()).find((person) => person.userId === f.memberId)?.unitId).toBe(child.id)
    await expect(row(f.page, 'Support desk').getByText('1 people', { exact: true })).toBeVisible()
    await f.page.screenshot({ path: info.outputPath('assigned-unit.png'), fullPage: true })
    await f.page.getByRole('tab', { name: 'Org chart', exact: true }).click()
    await f.page.getByRole('treeitem', { name: 'Support desk', exact: true }).click()
    const sheet = f.page.getByRole('dialog', { name: 'Support desk', exact: true })
    await expect(
      sheet.getByText('Member Author', { exact: true }).and(sheet.locator('span:not(.sr-only)')),
    ).toBeVisible()
    const removed = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.includes('/unit-roles/'),
    )
    await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
    expect((await removed).status()).toBe(204)
    expect(await f.roles()).toEqual([])
    expect((await f.roster()).find((person) => person.userId === f.memberId)?.unitId).toBeNull()
    await sheet.press('Escape')
    await f.page.getByRole('tab', { name: 'List', exact: true }).click()
    await expect(row(f.page, 'Support desk').getByText('0 people', { exact: true })).toBeVisible()
    await action(f.page, 'Delivery office', 'Delete')
    const confirmation = f.page.getByRole('dialog', {
      name: 'Delete “Delivery office”?',
      exact: true,
    })
    const deleted = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.endsWith(`/units/${root.id}`),
    )
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    expect((await deleted).status()).toBe(200)
    expect(await f.units()).toEqual([])
    await expect(f.page.getByRole('heading', { name: 'No units yet', exact: true })).toBeVisible()
    const deletionToast = f.page
      .locator('[data-sonner-toast]')
      .filter({ hasText: '“Delivery office” deleted' })
    const restored = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/units/${root.id}/restore`),
    )
    await deletionToast.getByRole('button', { name: 'Undo', exact: true }).click()
    expect((await restored).status()).toBe(200)
    expect((await f.units()).map((unit) => unit.id).sort()).toEqual([root.id, child.id].sort())
    await f.page.reload()
    await expect(row(f.page, 'Delivery office')).toBeVisible()
    await expect(row(f.page, 'Support desk')).toBeVisible()
    expect((await f.roster()).find((person) => person.userId === f.headId)).toMatchObject({
      membershipRole: 'head',
      unitId: null,
    })
    await f.page.goto('/people')
    await f.page.getByRole('radio', { name: 'Table', exact: true }).check()
    const headRow = f.page.getByRole('row').filter({ hasText: 'Head Author' })
    await expect(headRow.getByRole('cell', { name: 'Department-wide', exact: true })).toBeVisible()
    await f.page.screenshot({ path: info.outputPath('leadership-retained.png'), fullPage: true })
  } finally {
    await f.close()
  }
})

test('native row drag moves a child under another unit and persists its descendant path', async ({
  browser,
}, info) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/structure')
    const first = await add(f.page, 'First office')
    const second = await add(f.page, 'Second office')
    const child = await add(f.page, 'Move this team', first.name)
    const grandchild = await add(f.page, 'Nested team', child.name)
    const movedRequests: { parentUnitId: string | null }[] = []
    f.page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname.endsWith(`/units/${child.id}`)
      )
        movedRequests.push(request.postDataJSON() as { parentUnitId: string | null })
    })
    const patch = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith(`/units/${child.id}`),
    )
    await row(f.page, child.name).dragTo(row(f.page, second.name))
    expect((await patch).status()).toBe(200)
    await expect
      .poll(async () => (await f.units()).find((unit) => unit.id === child.id)?.parentUnitId)
      .toBe(second.id)
    const units = await f.units()
    expect(units.find((unit) => unit.id === grandchild.id)?.path).toContain(
      `${second.id}/${child.id}/${grandchild.id}/`,
    )
    await f.page.reload()
    await expect(row(f.page, child.name)).toBeVisible()
    await expect(row(f.page, grandchild.name)).toBeVisible()
    expect(movedRequests).toEqual([{ parentUnitId: second.id }])
    await f.page.screenshot({ path: info.outputPath('reparented-subtree.png'), fullPage: true })
  } finally {
    await f.close()
  }
})

test('interrupted unit creation retains the named draft for an actual retry', async ({
  browser,
}, info) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/structure')
    await f.page
      .locator('header')
      .filter({ has: f.page.getByRole('heading', { name: 'Structure', exact: true }) })
      .getByRole('button', { name: 'Add a unit', exact: true })
      .click()
    const dialog = f.page.getByRole('dialog', { name: 'New unit', exact: true })
    await dialog.getByRole('textbox', { name: 'Unit name', exact: true }).fill('Retained office')
    await f.page.route(`**${f.prefix}/units`, (route) =>
      route.request().method() === 'POST' ? route.abort('connectionfailed') : route.continue(),
    )
    const refused = f.page.waitForEvent(
      'requestfailed',
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/units'),
    )
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await refused
    expect(await f.units()).toEqual([])
    await expect(dialog.getByRole('alert')).toHaveText('Could not load the data')
    await expect(dialog).toHaveAttribute('data-state', 'open')
    await expect(dialog.getByRole('textbox', { name: 'Unit name', exact: true })).toHaveValue(
      'Retained office',
    )
    await f.page.screenshot({ path: info.outputPath('retained-unit-draft.png'), fullPage: true })
    await f.page.unroute(`**${f.prefix}/units`)
    const saved = f.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/units'),
    )
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    expect((await saved).status()).toBe(201)
    expect((await f.units()).map((unit) => unit.name)).toEqual(['Retained office'])
    await f.page.reload()
    await expect(row(f.page, 'Retained office')).toBeVisible()
  } finally {
    await f.close()
  }
})
