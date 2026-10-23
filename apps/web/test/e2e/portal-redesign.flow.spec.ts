import { expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'

type DisclosureFrame = {
  top: number
  bottom: number
  panelHeight: number
  scrollY: number
  scrollTop: number
  scrollLeft: number
}

type DisclosureWindow = Window & { __disclosureFrames?: Promise<DisclosureFrame[]> }

async function captureFilterTransition(page: Page): Promise<DisclosureFrame[]> {
  await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.devon-board-scroller')!
    const verticalScroller = window.matchMedia('(max-width: 767px)').matches
      ? board.querySelector<HTMLElement>('[data-board-column]')!
      : board
    ;(window as DisclosureWindow).__disclosureFrames = new Promise((resolve) => {
      const frames: DisclosureFrame[] = []
      const captureFrame = () => {
        const bounds = board.getBoundingClientRect()
        frames.push({
          top: bounds.top,
          bottom: bounds.bottom,
          panelHeight:
            document.getElementById('work-shell-mobile-chrome')?.getBoundingClientRect().height ??
            0,
          scrollY: window.scrollY,
          scrollTop: verticalScroller.scrollTop,
          scrollLeft: board.scrollLeft,
        })
      }
      captureFrame()
      // Begin with the actual disclosure state change, even if the pointer action waits on CI.
      // Sampling from evaluate() alone can finish before a delayed click ever starts the motion.
      const trigger = document.querySelector('[aria-controls="work-shell-mobile-chrome"]')!
      const observer = new MutationObserver(() => {
        observer.disconnect()
        const start = performance.now()
        const capture = () => {
          captureFrame()
          if (performance.now() - start < 500) requestAnimationFrame(capture)
          else resolve(frames)
        }
        capture()
      })
      observer.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] })
    })
  })
  await page.getByRole('button', { name: 'Filters and quick add', exact: true }).click()
  return page.evaluate(async () => (await (window as DisclosureWindow).__disclosureFrames)!)
}

function expectStableFilterTransition(frames: DisclosureFrame[]): void {
  const range = (values: number[]) => Math.max(...values) - Math.min(...values)
  expect(range(frames.map((frame) => frame.panelHeight))).toBeGreaterThan(30)
  // Every animation frame shares one bottom edge; neither flex gaps nor scroll anchoring jump.
  expect(range(frames.map((frame) => frame.bottom))).toBeLessThanOrEqual(2)
  expect(range(frames.map((frame) => frame.top - frame.panelHeight))).toBeLessThanOrEqual(2)
  expect(range(frames.map((frame) => frame.scrollY))).toBe(0)
  expect(range(frames.map((frame) => frame.scrollTop))).toBeLessThanOrEqual(1)
  expect(range(frames.map((frame) => frame.scrollLeft))).toBeLessThanOrEqual(1)
}

type PortalFixture = {
  context: BrowserContext
  page: Page
  unitIds: string[]
  me: { user: { id: string } }
  card: { id: string }
  simpleCard: { id: string }
  dueAt: Date
}

// Separate independent journeys so slow development-module hydration cannot consume the
// entire test budget before the final viewport checks. Each gets its own department and users.
const test = base.extend<{ portal: PortalFixture }>({
  portal: async ({ browser }, use, testInfo) => {
    const admin = await newFlowContext(browser)
    const context = await newFlowContext(browser)
    const memberContexts: Awaited<ReturnType<typeof newFlowContext>>[] = []
    try {
      await loginAsSuperAdmin(admin)
      const department = await createApprovedDepartment(context, admin, {
        headLogin: uniqueLogin('portal.head'),
        headPassword: examplePassword(),
        departmentName: 'Synthetic Portal QA',
      })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      expect(
        (
          await authedPatch(context, '/api/v1/ai/settings', {
            flags: { quick_add_parse: true },
            budgetUzsPerMonth: 1000000,
          })
        ).status(),
      ).toBe(200)
      const me = (await (await context.request.get('/api/v1/me')).json()) as {
        user: { id: string }
      }
      const unitResponse = await authedPost(
        context,
        `/api/v1/departments/${department.departmentId}/units`,
        { name: 'Research unit' },
      )
      expect(unitResponse.status()).toBe(201)
      const unit = (await unitResponse.json()) as { id: string }
      const unitIds = [unit.id]
      for (const name of ['Data & analytics', 'Digital transformation', 'Policy & delivery']) {
        const response = await authedPost(
          context,
          `/api/v1/departments/${department.departmentId}/units`,
          { name },
        )
        expect(response.status()).toBe(201)
        const other = (await response.json()) as { id: string }
        unitIds.push(other.id)
        expect(
          (
            await authedPatch(
              context,
              `/api/v1/departments/${department.departmentId}/units/${other.id}`,
              { expectedPeople: 5 },
            )
          ).status(),
        ).toBe(200)
      }
      expect(
        (
          await authedPatch(
            context,
            `/api/v1/departments/${department.departmentId}/units/${unit.id}`,
            { expectedPeople: 6 },
          )
        ).status(),
      ).toBe(200)
      expect(
        (
          await authedPost(context, `/api/v1/departments/${department.departmentId}/unit-roles`, {
            unitId: unit.id,
            userId: me.user.id,
            role: 'member',
          })
        ).status(),
      ).toBe(201)
      // Several people per unit make grouping, categorical tint and avatar overflow observable.
      const demoPeople = [
        { givenName: 'Nodira', familyName: 'Karimova', unitIndex: 0 },
        { givenName: 'Azizbek', familyName: 'Saidov', unitIndex: 1 },
        { givenName: 'Madina', familyName: 'Usmonova', unitIndex: 1 },
        { givenName: 'Kamoliddin', familyName: 'Rasulov', unitIndex: 2 },
        { givenName: 'Shahnoza', familyName: 'Ismoilova', unitIndex: 3 },
      ]
      const people = await Promise.all(
        demoPeople.map(async (person) => {
          const member = await newFlowContext(browser)
          memberContexts.push(member)
          await registerUser(member, {
            login: uniqueLogin('portal.member'),
            password: examplePassword(),
            ...person,
          })
          expect(
            (
              await authedPost(member, '/api/v1/departments/join', {
                key: department.joinKey,
                password: department.joinPassword,
              })
            ).status(),
          ).toBe(200)
          const memberMe = (await (await member.request.get('/api/v1/me')).json()) as {
            user: { id: string }
          }
          expect(
            (
              await authedPost(
                context,
                `/api/v1/departments/${department.departmentId}/unit-roles`,
                {
                  unitId: unitIds[person.unitIndex],
                  userId: memberMe.user.id,
                  role: 'member',
                },
              )
            ).status(),
          ).toBe(201)
          return { ...person, id: memberMe.user.id }
        }),
      )
      const csrf = await csrfToken(context)
      expect(
        (
          await context.request.put('/api/v1/accounts/professional-profile', {
            headers: { 'x-csrf-token': csrf },
            data: {
              version: 1,
              profile: {
                headline: 'Policy researcher',
                about: 'Research and public service.',
                education: [
                  {
                    institution: 'Example University',
                    degree: 'Master',
                    field: 'Public policy',
                    startYear: 2026,
                    endYear: 2028,
                    current: true,
                  },
                ],
                skills: ['Analysis', 'Public policy'],
              },
            },
          })
        ).status(),
      ).toBe(200)
      const dueAt = new Date()
      dueAt.setDate(dueAt.getDate() + 1)
      dueAt.setHours(12, 0, 0, 0)
      const projectResponses = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          authedPost(context, '/api/v1/projects', {
            title: `Research project ${i + 1}`,
            ownerUserId: me.user.id,
            members: [me.user.id, ...people.map((person) => person.id)],
          }),
        ),
      )
      for (const response of projectResponses) expect(response.status()).toBe(201)
      const firstProject = (await projectResponses[0]!.json()) as { id: string }
      const cardResponses = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          authedPost(context, '/api/v1/cards', {
            title:
              i === 0
                ? 'Review the department research findings and prepare the evidence package'
                : `Research task ${i + 1}`,
            assigneeUserId: me.user.id,
            dueAt:
              i === 2
                ? new Date(Date.now() - 86400000).toISOString()
                : i === 3
                  ? new Date(Date.now() + 30 * 86400000).toISOString()
                  : dueAt.toISOString(),
            ...(i === 0
              ? {
                  priority: 'high',
                  projectId: firstProject.id,
                  projectScope: 'subjective',
                }
              : {}),
          }),
        ),
      )
      for (const response of cardResponses) expect(response.status()).toBe(201)
      const card = (await cardResponses[0]!.json()) as { id: string }
      const simpleCard = (await cardResponses[1]!.json()) as { id: string }
      const memberCards = await Promise.all(
        people.flatMap((person, index) => [
          authedPost(context, '/api/v1/cards', {
            title: [
              'Validate source indicators',
              'Review data quality',
              'Prepare comparison charts',
              'Map service dependencies',
              'Draft policy recommendations',
            ][index],
            assigneeUserId: person.id,
            projectId: firstProject.id,
            projectScope: 'subjective',
            dueAt: dueAt.toISOString(),
          }),
          authedPost(context, '/api/v1/cards', {
            title: 'Prepare the weekly unit update',
            assigneeUserId: person.id,
            dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          }),
          authedPost(context, '/api/v1/cards', {
            title: 'Review stakeholder feedback',
            assigneeUserId: person.id,
            priority: index % 2 === 0 ? 'high' : 'none',
          }),
        ]),
      )
      for (const response of memberCards) expect(response.status()).toBe(201)
      expect(
        (
          await authedPost(context, `/api/v1/cards/${card.id}/checklist`, {
            text: 'Review source evidence',
          })
        ).status(),
      ).toBe(201)
      expect(
        (
          await authedPatch(context, `/api/v1/cards/${card.id}`, {
            workStage: 'in_progress',
          })
        ).status(),
      ).toBe(200)
      expect(
        (
          await authedPost(context, '/api/v1/events', {
            title: 'Research workshop',
            startsAt: dueAt.toISOString(),
            endsAt: new Date(dueAt.getTime() + 3600000).toISOString(),
          })
        ).status(),
      ).toBe(201)

      const page = await context.newPage()
      page.setDefaultTimeout(15_000)
      page.setDefaultNavigationTimeout(15_000)
      // Keep geometry assertions and visual artifacts independent of entrance/layout animations.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 1440, height: 1000 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await use({ context, page, unitIds, me, card, simpleCard, dueAt })
      expect(errors).toEqual([])
    } finally {
      // A test timeout may have already closed a context. Keep the original action failure visible
      // while still attempting every owned context's teardown.
      const cleanup = await Promise.allSettled([
        ...memberContexts.map((member) => member.close()),
        context.close(),
        admin.close(),
      ])
      cleanup.forEach((result) => {
        if (result.status === 'rejected') {
          testInfo.annotations.push({ type: 'context-cleanup', description: String(result.reason) })
        }
      })
    }
  },
})

test.describe.configure({ timeout: 120_000 })

test('@flow compact board, route scrolling, calendar overflow and mobile navigation', async ({
  portal,
}, testInfo) => {
  const { page, unitIds, me, card, simpleCard, dueAt } = portal
  await page.goto('/projects')
  await expect(page.getByText('Research project 12', { exact: true })).toBeVisible()
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }),
  )
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
  await page.locator('aside a[href="/work"]').first().click()
  const board = page.getByRole('region', {
    name: 'People board',
    exact: true,
  })
  await expect(board).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  const boardTab = page
    .getByRole('navigation', { name: 'Cards', exact: true })
    .getByRole('link', { name: 'Board', exact: true })
  const personJump = page.getByRole('combobox', { name: 'Jump to a person', exact: true })
  const tabBounds = (await boardTab.boundingBox())!
  const jumpBounds = (await personJump.boundingBox())!
  expect(
    Math.abs(tabBounds.y + tabBounds.height / 2 - jumpBounds.y - jumpBounds.height / 2),
  ).toBeLessThanOrEqual(8)
  const unitBackgrounds = await Promise.all(
    unitIds.map((id) =>
      board
        .locator(`[data-unit-id="${id}"]`)
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ),
  )
  expect(new Set(unitBackgrounds).size).toBe(4)
  await expect(board.getByText('In progress', { exact: true }).first()).toBeVisible()
  const simpleTile = page.locator(`[data-dnd-card="${simpleCard.id}"]`)
  expect((await simpleTile.boundingBox())!.height).toBeLessThanOrEqual(82)
  expect(await simpleTile.locator('time svg').count()).toBe(0)
  expect(await simpleTile.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    await page
      .locator(`[data-dnd-card="${card.id}"]`)
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  )
  const backgroundFor = (risk: string) =>
    board
      .locator(`[data-risk="${risk}"][data-task-origin="standalone"]`)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  // User revised the visual contract: origin owns card fill; urgency only accents the date.
  expect(await backgroundFor('overdue')).toBe(await backgroundFor('at_risk'))
  expect(await backgroundFor('none')).toBe(await backgroundFor('at_risk'))
  const richTile = page.locator(`[data-dnd-card="${card.id}"]`)
  await expect(richTile.getByText('High', { exact: true })).toBeVisible()
  expect(
    (await richTile.getByRole('button', { name: /Review the department research/ }).boundingBox())!
      .height,
  ).toBeLessThanOrEqual(42)
  const projectLink = richTile.getByRole('link', {
    name: 'Research project 1',
    exact: true,
  })
  expect((await projectLink.boundingBox())!.y).toBeLessThan(
    (await richTile.getByRole('button', { name: /Review the department research/ }).boundingBox())!
      .y,
  )
  await simpleTile.getByRole('button', { name: 'Card actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Select card', exact: true }).click()
  await expect(simpleTile.getByRole('checkbox')).toBeChecked()
  await simpleTile.getByRole('checkbox').click()
  await expect(simpleTile.getByRole('checkbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sort cards: Manual', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Attention first', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Sort cards: Attention', exact: true }),
  ).toBeVisible()
  const headColumn = board.locator(`[data-board-column="${me.user.id}"]`)
  await expect(headColumn.locator('[data-dnd-card]').first()).toContainText('Research task 3')
  await page.getByRole('button', { name: 'Sort cards: Attention', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Manual order', exact: true }).click()
  await headColumn.getByRole('button', { name: 'Add with AI', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add with AI', exact: true })).toContainText(
    'Assignee: Test Head',
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const initial = await board.boundingBox()
  expect(initial!.height).toBeGreaterThan(500)
  expect(initial!.y + initial!.height).toBeGreaterThan(930)
  expect(initial!.y + initial!.height).toBeLessThanOrEqual(1000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await board.hover({ position: { x: 120, y: 220 } })
  await page.mouse.wheel(180, 60)
  await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100)
  await expect.poll(() => board.evaluate((el) => el.scrollTop)).toBeGreaterThan(30)
  const opening = await captureFilterTransition(page)
  await expect
    .poll(async () => (await board.boundingBox())!.height)
    .toBeLessThan(initial!.height - 30)
  const closing = await captureFilterTransition(page)
  await expect
    .poll(async () => (await board.boundingBox())!.height)
    .toBeGreaterThan(initial!.height - 5)
  await testInfo.attach('filter-transition-frames', {
    body: JSON.stringify({ opening, closing }),
    contentType: 'application/json',
  })
  expectStableFilterTransition(opening)
  expectStableFilterTransition(closing)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await board.evaluate((el) => el.scrollTo({ left: 0, top: 0, behavior: 'instant' }))
  // Both cases share one pointer and viewport, so their hover transitions must run in order.
  /* eslint-disable no-restricted-syntax */
  for (const origin of ['project', 'standalone']) {
    const delegatedTile = board
      .locator(`[data-task-origin="${origin}"]`)
      .filter({
        has: page.locator('.devon-avatar-stack-item + .devon-avatar-stack-item'),
      })
      .first()
    await delegatedTile.scrollIntoViewIfNeeded()
    await page.mouse.move(0, 0)
    const geometry = await delegatedTile.evaluate((tile) => {
      const normalizeColor = (color: string) => {
        const probe = document.createElement('span')
        probe.style.color = color
        document.body.append(probe)
        const normalized = getComputedStyle(probe).color
        probe.remove()
        return normalized
      }
      return {
        surface: normalizeColor(getComputedStyle(tile).backgroundColor),
        faces: [...tile.querySelectorAll<HTMLElement>('.devon-avatar-stack-item')].map(
          (wrapper) => {
            const face = wrapper.firstElementChild as HTMLElement
            const bounds = wrapper.getBoundingClientRect()
            const faceBounds = face.getBoundingClientRect()
            const style = getComputedStyle(face)
            return {
              width: bounds.width,
              height: bounds.height,
              faceWidth: faceBounds.width,
              faceHeight: faceBounds.height,
              wrapperShadow: getComputedStyle(wrapper).boxShadow,
              shadow: style.boxShadow,
              ring: normalizeColor(style.getPropertyValue('--tw-ring-color').trim()),
              zIndex: Number(getComputedStyle(wrapper).zIndex),
            }
          },
        ),
      }
    })
    expect(geometry.faces).toHaveLength(2)
    for (const face of geometry.faces) {
      expect(face.width).toBeCloseTo(face.height)
      expect(face.width).toBeCloseTo(face.faceWidth)
      expect(face.height).toBeCloseTo(face.faceHeight)
      expect(face.wrapperShadow).toBe('none')
      expect(face.ring).toBe(geometry.surface)
    }
    expect(geometry.faces[0]!.shadow).toBe(geometry.faces[1]!.shadow)
    expect(geometry.faces[0]!.zIndex).toBeGreaterThan(geometry.faces[1]!.zIndex)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const rightAvatar = delegatedTile.locator('.devon-avatar-stack-item').last()
    await rightAvatar.hover()
    await expect
      .poll(() =>
        rightAvatar.evaluate((wrapper) => {
          const face = wrapper.firstElementChild!.getBoundingClientRect()
          return face.width > wrapper.getBoundingClientRect().width
        }),
      )
      .toBe(true)
    const hovered = await rightAvatar.evaluate((wrapper) => ({
      width: wrapper.getBoundingClientRect().width,
      height: wrapper.getBoundingClientRect().height,
      faceWidth: wrapper.firstElementChild!.getBoundingClientRect().width,
      faceHeight: wrapper.firstElementChild!.getBoundingClientRect().height,
      zIndex: Number(getComputedStyle(wrapper).zIndex),
      siblingZIndex: Number(getComputedStyle(wrapper.previousElementSibling!).zIndex),
    }))
    expect(hovered.width).toBe(24)
    expect(hovered.height).toBe(24)
    expect(hovered.faceWidth).toBeCloseTo(hovered.faceHeight)
    expect(hovered.zIndex).toBeGreaterThan(hovered.siblingZIndex)
    await delegatedTile.screenshot({
      path: testInfo.outputPath(`participants-${origin}-hover.png`),
    })
    await page.mouse.move(0, 0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
  }
  await board.evaluate((el) => el.scrollTo({ left: 0, top: 0, behavior: 'instant' }))
  /* eslint-enable no-restricted-syntax */
  await page.screenshot({ path: testInfo.outputPath('cards-desktop.png') })
  await page.goto('/work?new=1')
  const titleInput = page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true })
  await expect(titleInput).toHaveAttribute('maxlength', '120')
  await titleInput.fill('A'.repeat(121))
  expect((await titleInput.inputValue()).length).toBe(120)
  await page.keyboard.press('Escape')
  await page.goto(
    `/work/calendar?month=${dueAt.getFullYear()}-${String(dueAt.getMonth() + 1).padStart(2, '0')}`,
  )
  const event = page.getByRole('button', {
    name: 'Research workshop',
    exact: true,
  })
  await expect(event).toBeVisible()
  const cell = event.locator('xpath=../..')
  const height = (await cell.boundingBox())!.height
  await cell.getByRole('button', { name: /more/i }).click()
  await expect(cell.getByRole('button', { name: /less/i })).toBeVisible()
  expect((await cell.boundingBox())!.height).toBe(height)
  expect(
    await cell.locator('div.overflow-y-auto').evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('calendar-desktop.png'),
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/work')
  await expect(board).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  expect((await board.boundingBox())!.height).toBeGreaterThan(350)
  expect((await simpleTile.boundingBox())!.height).toBeLessThanOrEqual(80)
  await expect(page.getByRole('button', { name: 'View: Board', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Choose a person', exact: true })).toBeVisible()
  expect((await headColumn.boundingBox())!.width).toBeGreaterThan(
    (await board.boundingBox())!.width * 0.9,
  )
  expect(await board.evaluate((el) => getComputedStyle(el).scrollSnapType)).toContain('x')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await headColumn.hover({ position: { x: 120, y: 220 } })
  await page.mouse.wheel(0, 60)
  await expect.poll(() => headColumn.evaluate((el) => el.scrollTop)).toBeGreaterThan(30)
  const phoneOpening = await captureFilterTransition(page)
  const phoneClosing = await captureFilterTransition(page)
  await testInfo.attach('filter-transition-phone-frames', {
    body: JSON.stringify({ opening: phoneOpening, closing: phoneClosing }),
    contentType: 'application/json',
  })
  expectStableFilterTransition(phoneOpening)
  expectStableFilterTransition(phoneClosing)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await headColumn.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }))
  await page.getByRole('button', { name: 'Next columns', exact: true }).click()
  await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(200)
  await page.getByRole('button', { name: 'Previous columns', exact: true }).click()
  await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeLessThan(5)
  await expect(page.getByRole('combobox', { name: 'Choose a person', exact: true })).toContainText(
    'Test Head',
  )
  await expect(page.locator('[data-board-mobile-navigation]')).toContainText('1/7')
  await page.getByRole('combobox', { name: 'Choose a person', exact: true }).click()
  await page.getByRole('option', { name: 'Unassigned', exact: true }).click()
  await expect
    .poll(() => board.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft))
    .toBeLessThan(3)
  await expect(page.locator('[data-board-mobile-navigation]')).toContainText('7/7')
  await board.hover({ position: { x: 160, y: 150 } })
  await page.mouse.wheel(-360, 0)
  await expect
    .poll(() => board.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft))
    .toBeGreaterThan(300)
  await expect(
    page.getByRole('combobox', { name: 'Choose a person', exact: true }),
  ).not.toContainText('Unassigned')
  await page.getByRole('combobox', { name: 'Choose a person', exact: true }).click()
  await page.getByRole('option', { name: /Test Head/ }).click()
  await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeLessThan(3)
  await expect(page.locator('[data-board-mobile-navigation]')).toContainText('1/7')
  await page.screenshot({
    path: testInfo.outputPath('cards-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => localStorage.setItem('devon_theme', 'dark'))
  await page.reload()
  await expect(board).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({
    path: testInfo.outputPath('cards-dark.png'),
    fullPage: true,
  })
  await page.goto('/work/calendar?from=overview&month=2026-01')
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByRole('link', { name: /Back to overview/ })).toBeVisible()
})

test('@flow professional directory, staffing and responsive head overview', async ({
  portal,
}, testInfo) => {
  const { context, page } = portal
  await page.goto('/people')
  await page
    .getByRole('button')
    .filter({ has: page.getByText('Policy researcher', { exact: true }) })
    .click()
  await expect(page.getByRole('dialog')).toContainText('Example University')
  await expect(page.getByRole('dialog')).toContainText('2028')
  await expect
    .poll(async () =>
      Math.round(
        (await page.getByRole('dialog').boundingBox())!.x +
          (await page.getByRole('dialog').boundingBox())!.width,
      ),
    )
    .toBe(1440)
  await page.screenshot({ path: testInfo.outputPath('profile-desktop.png') })
  await page.keyboard.press('Escape')
  await page.goto('/account#section-professional')
  const profileSection = page.locator('#section-professional')
  await profileSection.getByLabel('Headline', { exact: true }).fill('Senior policy researcher')
  await profileSection.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await context.request.get('/api/v1/accounts/professional-profile')).json()).profile
          .headline,
    )
    .toBe('Senior policy researcher')
  await page.goto('/structure')
  await page.getByRole('tab', { name: 'Org chart', exact: true }).click()
  await expect(page.getByRole('tree')).toContainText('Test Head')
  await page.screenshot({
    path: testInfo.outputPath('structure-desktop.png'),
  })
  await page.goto('/')
  await expect(page.getByText('Total workforce', { exact: true })).toBeVisible()
  await expect(page.getByTestId('home-inbox')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await expect(page.getByTestId('head-overview').getByRole('textbox')).toHaveCount(0)
  const workforceAvatars = page.getByTestId('overview-workforce-avatars')
  await expect(workforceAvatars.getByRole('link')).toHaveCount(5)
  await workforceAvatars.getByRole('link', { name: 'Test Head', exact: true }).hover()
  await expect(page.getByText('Senior policy researcher', { exact: true })).toBeVisible()
  await page.getByText('Total workforce', { exact: true }).hover()
  // A single page is being resized; these operations depend on the previous viewport.
  /* eslint-disable no-restricted-syntax */
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(viewport.height + 1)
    const inbox = await page.getByTestId('home-inbox').boundingBox()
    expect(inbox!.y + inbox!.height).toBeLessThanOrEqual(viewport.height)
    expect(
      await page
        .getByTestId('head-overview')
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`overview-${viewport.width}.png`),
    })
  }
  /* eslint-enable no-restricted-syntax */
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({
    path: testInfo.outputPath('overview-desktop.png'),
  })
  await page.locator('main a[href="/structure?from=overview"]').first().click()
  await expect(page.getByRole('link', { name: /Back to overview/ })).toBeVisible()
  await page.getByRole('link', { name: /Back to overview/ }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeLessThanOrEqual(844)
  await page.getByRole('radio', { name: 'Work overview', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Workforce by unit', exact: true })).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Workforce by unit', exact: true })
      .getByRole('link', { name: /Research unit/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', {
      name: 'Upcoming · next 30 days',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Upcoming · next 30 days', exact: true })
      .getByRole('link', { name: /Review the department research/ }),
  ).toBeVisible()
  await page.getByRole('radio', { name: 'Inbox', exact: true }).click()
  const mobileInbox = await page.getByTestId('home-inbox').boundingBox()
  expect(mobileInbox!.y + mobileInbox!.height).toBeLessThan(790)
  await page.getByRole('radio', { name: 'Work overview', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('overview-mobile.png') })
  await page.setViewportSize({ width: 390, height: 667 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeLessThanOrEqual(667)
  // Short phones retain the earliest deadline, with the remaining entries in the calendar.
  const shortPhoneDeadline = page
    .getByRole('region', { name: 'Upcoming · next 30 days', exact: true })
    .getByRole('link')
    .first()
  await expect(shortPhoneDeadline).toBeVisible()
  await expect(shortPhoneDeadline).toHaveAttribute('href', /\/work\/calendar\?month=/)
  await page.screenshot({ path: testInfo.outputPath('overview-mobile-short.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/structure')
  await page.getByRole('tab', { name: 'List', exact: true }).click()
  const mobileStaffing = page.getByTestId('mobile-unit-staffing').getByRole('spinbutton').first()
  await expect(mobileStaffing).toBeVisible()
  expect((await mobileStaffing.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await mobileStaffing.fill('8')
  const staffingSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/units/') &&
      response.ok(),
  )
  await mobileStaffing.press('Enter')
  await staffingSaved
  await page.reload()
  await page.getByRole('tab', { name: 'List', exact: true }).click()
  await expect(mobileStaffing).toHaveValue('8')
  await page.screenshot({ path: testInfo.outputPath('structure-mobile.png') })
  await page.goto('/people')
  await expect(page.getByText('Senior policy researcher', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('people-mobile.png'),
    fullPage: true,
  })
})
