import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import {
  FLOW_SERVICES_FILE,
  withOwnedPublisherFault,
  type FlowServiceState,
} from './flow-services.js'

test('connected observers reconcile writes when the real server publisher is unavailable', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('publisher.head'),
      headPassword: examplePassword(),
      departmentName: 'Local publisher failure QA',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('publisher.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    for (const context of [head, member])
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const headUser = (await (await head.request.get('/api/v1/me')).json()).user.id as string
    const response = await authedPost(head, '/api/v1/cards', {
      title: 'Publisher version 1',
      assigneeUserId: headUser,
    })
    expect(response.status()).toBe(201)
    const card = (await response.json()) as { id: string }
    const editor = await head.newPage()
    const observer = await member.newPage()
    let connected = 0
    let publications = 0
    const pageErrors: string[] = []
    observer.on('pageerror', (error) => pageErrors.push(error.message))
    observer.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        for (const line of payload.toString().split('\n')) {
          let parsed: unknown
          try {
            parsed = JSON.parse(line)
          } catch {
            continue
          }
          for (const record of Array.isArray(parsed) ? parsed : [parsed]) {
            if (record?.connect?.client) connected++
            if (record?.push?.pub?.data?.type === 'work.card.updated') publications++
          }
        }
      }),
    )
    await Promise.all([editor.goto('/work'), observer.goto('/work')])
    const observedCard = observer.locator(`[data-dnd-card="${card.id}"]`)
    await expect(
      observedCard.getByRole('button', { name: 'Publisher version 1', exact: true }),
    ).toBeVisible()
    await expect.poll(() => connected).toBe(1)
    await editor
      .locator(`[data-dnd-card="${card.id}"]`)
      .getByRole('button', { name: 'Publisher version 1', exact: true })
      .click()
    const state = JSON.parse(readFileSync(FLOW_SERVICES_FILE, 'utf8')) as FlowServiceState
    await withOwnedPublisherFault(state, async () => {
      // The owned broker's health and signed client connections work, while the API's original HTTP
      // key is actually refused with 401 (checked by the helper). No successful response is mocked.
      await expect.poll(() => connected, { timeout: 25_000 }).toBe(2)
      const before = publications
      const saved = editor.waitForResponse(
        (reply) =>
          reply.request().method() === 'PATCH' &&
          new URL(reply.url()).pathname === `/api/v1/cards/${card.id}`,
      )
      await editor
        .getByRole('textbox', { name: 'Title', exact: true })
        .fill('Publisher version 2 while HTTP is denied')
      await editor.getByRole('textbox', { name: 'Title', exact: true }).press('Tab')
      expect((await saved).status()).toBe(200)
      expect((await (await member.request.get(`/api/v1/cards/${card.id}`)).json()).title).toBe(
        'Publisher version 2 while HTTP is denied',
      )
      try {
        // Thirty seconds is the reconciliation ceiling: a live-but-unpublished write must not
        // remain hidden forever. The bound includes a small scheduling margin and no reload.
        await expect(
          observedCard.getByRole('button', {
            name: 'Publisher version 2 while HTTP is denied',
            exact: true,
          }),
        ).toBeVisible({ timeout: 35_000 })
        expect(publications).toBe(before)
        expect(connected).toBe(2)
        expect(pageErrors).toEqual([])
      } finally {
        await observer.screenshot({
          path: test.info().outputPath('connected-publisher-unavailable.png'),
          fullPage: true,
        })
        await test.info().attach('publisher-failure-boundary', {
          body: JSON.stringify(
            {
              connected,
              publicationsBefore: before,
              publicationsAfter: publications,
              pageErrors,
              persistedTitle: 'Publisher version 2 while HTTP is denied',
            },
            null,
            2,
          ),
          contentType: 'application/json',
        })
      }
    })
  } finally {
    await Promise.all([admin.close(), head.close(), member.close()])
  }
})
